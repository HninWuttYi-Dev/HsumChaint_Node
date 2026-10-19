# Monastery spaces

All endpoints use `/api/v1/spaces` and require a Bearer access token.
Monk and Donor remain global account types. System Admin is an additional,
database-managed global role (`roles.space_id IS NULL`) checked on every request.
Registration cannot assign it. The migration creates that role with no assignees;
an operator must explicitly insert a `system_role_assignments` row for a trusted user.

| Method | Path | Body / access |
| --- | --- | --- |
| POST | `/` | `{name, description?}`; Monk accounts |
| GET | `/` | Owned/joined spaces; all spaces for System Admin |
| GET | `/permissions` | Permission catalog |
| GET | `/:spaceId` | Space.View |
| PATCH | `/:spaceId` | `{name?, description?}`; Space.Settings.Edit |
| DELETE | `/:spaceId` | Owner or System Admin |
| GET | `/:spaceId/roles` | Owner or System Admin |
| POST | `/:spaceId/roles` | `{name, permissions: string[]}`; owner or System Admin |
| PUT | `/:spaceId/roles/:roleId` | Replace name/permissions; owner or System Admin |
| GET | `/:spaceId/members` | Space.View |
| POST | `/:spaceId/members` | `{userId, roleId}`; Space.Member.Invite |
| PATCH | `/:spaceId/members/:userId` | `{roleId}`; owner or System Admin |
| DELETE | `/:spaceId/members/:userId` | Space.Member.Manage |

List endpoints accept `page` (default 1) and `limit` (default 20, maximum 100).
Successful responses contain `data`; deletes return 204. Invalid input returns 400,
missing resources 404, denied access 403, and duplicate role names/memberships 409.
Invitations immediately add existing accounts; there is no pending acceptance or notification workflow.

Creation atomically provisions Space Admin, Space Editor, and Space Viewer roles.
Owners bypass space permissions and do not need a membership. Admins can edit settings,
invite/remove members, post, and manage donations. Only owners/System Admins customize
roles or reassign memberships. Admin invitations are restricted to roles containing only
view, post-create, and donation-create permissions to prevent privilege escalation.
Editors can view, post, and create donation records; Viewers can view.
Post and donation permissions are catalog entries for future domain endpoints.

Memberships use a composite foreign key that prevents roles from another space being assigned.
Role/member changes increment a space revision in the same transaction. Cached membership
permission snapshots use that revision and a 60-second TTL; every authorization reads the
current space revision and active user status. Redis failures fall back to MySQL.
Space deletion permanently removes its roles and memberships.

The existing account model has no monk verification status. Creation currently requires the
persisted Monk account type; a verification workflow needs a separate product decision.

## Setup and checks

With the application's database configuration available:

```sh
bun install --frozen-lockfile
bunx prisma generate
bun run db:migrate:prod
bunx tsc --noEmit
bun test src/modules/space
```

The integration test requires a disposable MySQL database with all migrations applied.
Set `SPACE_TEST_DATABASE_URL` to opt in, then run
`bun test src/modules/space/space.integration.test.ts`. It creates and removes its own
users/spaces; permission catalog rows may remain. Without that variable it is skipped.
