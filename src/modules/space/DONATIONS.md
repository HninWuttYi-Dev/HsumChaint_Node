# Space donation workflow

The workflow follows the supplied `HsumChaint_CSharp` project, specifically
`HsumChaint.Domain/Features/Donation/Services/DonationService.cs`, its DTOs,
`HsumChaint.API/Features/Donation/Controllers/DonationsController.cs`, the shared
DonationStatus/DonationType enums, and DonationServiceTests/NewFeaturesTests.

## Endpoints

All endpoints require a Bearer access token and an active user. The canonical
base path matches C#: `/api/v1/donations`.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/request` | Submit the authenticated donor's request; starts PendingReview |
| POST | `/manual` | Reviewer records an account or offline donor; starts Accepted or Scheduled |
| POST | `/batch` | Atomically record 1-50 manual donations |
| POST | `/recurring/request` | Submit 1-24 monthly donation requests |
| POST | `/recurring/manual` | Reviewer records an account/offline donor's monthly series |
| GET | `/` | Own history by default, or a member's space history |
| GET | `/:donationId` | Retrieve own donation or a donation in a space the user belongs to |
| PUT | `/:donationId/review` | Accept/reject and record reviewer, time and optional note |
| PUT | `/:donationId/schedule` | Set pickup/dropoff times and mark Scheduled |
| PUT | `/:donationId/complete` | Record Completed status and time |
| PUT | `/:donationId/cancel` | Donor cancels own donation, or reviewer cancels a space donation |
| DELETE | `/:donationId` | Reviewer deletes a non-completed donation |
| GET | `/calendar?year=2026&month=11` | C# monthly summary, optionally filtered by space and status |

The same workflow is available under `/api/v1/spaces/:spaceId/donations`
(and the existing `/api/v1/monasteries/:spaceId/donations` alias). This version
takes the space ID from the URL and accepts `POST /` as a request alias and
PATCH as an alias for PUT lifecycle actions. Conflicting space IDs in bodies
or queries are rejected.

## Requests and enums

A donor does not need monastery membership to submit a request. The active
space must exist and the donor must have Donation.Create (or a corresponding
space grant). The server reads their name/account ID from the authenticated
user; donor identity, reviewer and status fields cannot be supplied.

```json
{
  "monasterySpaceId": 10,
  "donationType": 1,
  "quantity": 12,
  "note": "Rice bags",
  "pickupTime": "2026-12-01T06:00:00Z"
}
```

Donation type values match C#: Money=0, Food=1, Medicine=2, Robe=3,
Supplies=4, Other=5. Exact enum names are also accepted. Other requires a
nonblank customDonationType. Optional fields are customDonationType, note,
amount, quantity, pickupTime and dropoffTime. Amount/quantity accept zero and
positive Decimal(18,2) values, as numbers or strings. Use strings for large
amounts to preserve precision; numeric inputs are limited to the safe integer
cent range. Responses serialize decimals as strings. Dated times require a
timezone offset.

Manual submissions additionally accept donorId or donorName. If donorId is
supplied, it must identify an active user, and that user's name is used. If it
is omitted/null, donorName is required and the stored donorId is null. Manual
entries are Scheduled when pickup/dropoff is present, otherwise Accepted;
reviewer and reviewedAt are recorded immediately.

Batch input is `{ monasterySpaceId, donations: [ /* manual inputs */ ] }`.
The whole batch, including in-app notifications, commits or rolls back together.

Recurring input replaces dated pickup/dropoff fields with startDate (ISO date
or dated timestamp), dayOfMonth (1-31), monthsCount (1-24), and optional
pickupTimeOfDay/dropoffTimeOfDay (`HH:mm` or `HH:mm:ss`). The first booking is
in startDate's UTC month. Short months clamp the day, including leap years;
booking times use UTC, matching the C# service. All rows share a series tag in
the note. Recurring notes are limited to 900 characters to leave room for the
series prefix within the database column. Manual recurring input additionally
accepts donorId/donorName.

## Lifecycle and permissions

| Status | C# numeric value |
| --- | --- |
| Draft | 0 |
| Submitted | 1 |
| PendingReview | 2 |
| Accepted | 3 |
| Scheduled | 4 |
| Completed | 5 |
| Rejected | 6 |
| Cancelled | 7 |

Review accepts `{ "status": 3, "note": "Accepted" }` or status 6; the names
Accepted/Rejected also work. As in C#, any status except Completed/Cancelled
can be reviewed, so a rejection can be reconsidered. Blank review notes retain
the previous note. Scheduling requires at least one dated time and replaces
both times (omission clears the other time); Rejected/Cancelled/Completed
cannot be scheduled. Rejected/Cancelled cannot be completed. Completed cannot
be cancelled or deleted. Other transitions, including completion of a pending
record, follow C# rather than the earlier provisional Node state machine.

Manual creation, batch/manual recurrence, review and deletion require space
ownership or an active Donation.Review grant on the membership role.
Scheduling/completion independently require Donation.Schedule. Cancellation
requires the donor's own record or the same reviewer authority. Nonmembers
cannot manage a space even with global administrator permissions. Existing
Node Space.Donation.Review/Create/Schedule grants remain recognized aliases.
In addition, canonical endpoints enforce the C# controller's global endpoint
permission: Donation.Create for all creation paths, Donation.View for reads,
Donation.Review for review, Donation.Schedule for schedule/completion,
Donation.Cancel for cancellation and Donation.Delete for deletion. Thus a
review grant alone does not permit manual creation, cancellation or deletion,
and ownership of a donor record does not bypass a revoked Cancel grant.
Scoped aliases can satisfy this endpoint check through a space role or space
ownership, in addition to global grants. Service ownership/membership rules
still apply after the endpoint permission check.
Permission checks use current database state, including role/permission
soft deletion, rather than cached token claims. As in the C# service, members
can view their space's donation history; donors can view their own records
without membership. Unscoped own-history listing also requires Donation.View.

The migration/seed adapts permissions to existing Node role IDs: Monk=1,
Donor=2, Admin=3, Space Admin=4, Space Moderator=5, Space Editor=6,
Space Member=7. Existing Node role IDs are preserved. Review remains with
owners/admins/moderators; editors gain scheduling independently. Donors and
space members receive create/view/own-cancellation permissions. Custom roles
are checked by permission name, not hardcoded role ID.

Updates/deletes use transactions and conditional predicates to reject stale
writes with HTTP 409. Validation errors return 400, denied operations 403,
and absent/cross-space IDs 404. Node retains its `{ success, message, data }`
response envelope. DTO status/donationType are numeric, as in C#.

## History and calendars

List filters are monasterySpaceId, donorId, status (numeric or enum name),
fromDate/toDate (inclusive ISO date-times), pageNumber (default 1, maximum
1,000,000), and pageSize (default 10, maximum 100). Filtering occurs before
counting/paging; ordering is createdAt ascending then ID ascending. Without a
space filter, only the caller's own donations are visible and another donorId
is denied. Responses return the DTO array in data with a top-level pagination
object containing pageNumber, pageSize, totalCount, totalPages,
hasPreviousPage and hasNextPage.

The year/month calendar groups by UTC pickup date, falling back to createdAt,
as the C# service does. It returns year, month, totalDonationsCount,
totalAmount (an exact decimal string), and days with donation counts/DTOs.
No space filter means own history; a space filter requires membership.

The pre-existing date-range calendar remains available unchanged at
`/api/v1/donations/calendar?monasterySpaceId=10&fromDate=2026-11-01&toDate=2026-11-30`.
It uses Myanmar dates and pickup/dropoff/creation fallback. Supplying year or
month selects the new C# summary instead. Offline donor names work in both.

## Notifications and deployment

Requests notify space owners and members with active review permissions.
Manual account entries and lifecycle updates notify the donor; offline donors
have no account notification. A recurring series sends one notification per
recipient. Notifications commit with the donation transaction; FCM push runs
after commit. Push failure is logged while the in-app notification is retained.
The Node notification type is 5 for donation updates, since this repository
already uses 1 for invitations and 2-4 for reminders. Push data uses
`{ donationId, type: "Donation" }` with title Donation Update.

Run `prisma migrate deploy` before starting the new application. The additive
`20261023120000_space_donation_workflow` migration makes Donor_List.donor_id
nullable and inserts donation permissions/default grants. Existing rows, IDs,
foreign keys and C# status codes are preserved. It does not rewrite numeric
statuses from the earlier unmerged provisional Node implementation; if that
version was run separately, audit its data before adopting C# status codes.
The legacy DonationList/DonationType tables remain separate.

Accepted/Scheduled dated donations continue to feed the existing reminder
job. Offline donors are omitted as recipients while monastery managers still
receive reminders. The job's existing Myanmar-time rules are retained.

## Verification

`bun test src/modules/space/tests/donation.test.ts` runs isolated service/HTTP
cases derived from the supplied C# tests, with per-test transactional database
doubles and no persistent writes. Coverage includes enum contracts, identities,
manual/offline donors, review/schedule independence, lifecycle guards,
notifications, rollback/push failure, pagination, recurring month boundaries,
monthly totals and both calendar routes. The reminder tests cover offline donors.
The disposable migration test also inserts an offline donor and verifies schema
drift when MIGRATION_TEST_SERVER_URL is provided. Generate Prisma first, then
run `bunx tsc --noEmit`, `bun test`, and `bun run build`.
