# Existing-data upgrade

PR #24 keeps the existing `users`, `monk_profile`, `refresh_tokens`,
`password_reset_tokens`, `donors`, `donation_types`, `donation_lists`, and
`donation_list_donors` tables. Existing IDs, credentials, timestamps, soft-delete
flags, tokens and donation relationships are retained.

The upgrade renames `username` to `name` and `contactPhone` to `contact_phone`,
and converts `user_type` to `role_id` (Monk = 1, Donor = 2). It initializes those
roles before enforcing the foreign key. Existing string columns are never
shortened. New monastery and donation tables are additive.

The existing donor API continues to use `donors`, preserving its IDs and
`phoneNo` response contract. Donor contact records are not silently merged with
login accounts. Legacy donation records remain available through their Prisma
models; they are not automatically copied into `Donor_List`, whose ownership,
amount, status and monastery semantics require a separate mapping decision.

Signed legacy access tokens remain accepted until expiry. Refresh uses the
current account role. Cached pre-upgrade user payloads are refreshed from the
database, and user lists use a new cache namespace.

## Deployment

- Take a database backup and run this upgrade against a copy of the target
  database before deployment. MySQL DDL is not transactionally rolled back.
- Use `prisma migrate deploy`, not `prisma db push`, for the data conversion.
- This replacement is for an **unapplied** `20261010161744_init_new_schema`
  migration. If the original destructive migration has already run, stop:
  changing its SQL cannot recover deleted records. Restore from backup and
  reconcile migration history before upgrading. Do not mark it applied blindly.
- Stop old application writers during the column conversion. Deploy the new
  application after migration completion.
- Merging into `develop` triggers the repository's deployment workflow.

## Disposable migration check

Set `MIGRATION_TEST_SERVER_URL` to a disposable MySQL server URL without a
database path, then run:

```sh
bun test tests/migration-data-preservation.test.ts
```

The test creates and removes its own uniquely named database. It applies the
historical migrations, loads account/profile/token/donation fixtures, applies
the upgrade, compares all preserved records, checks new relationships and
auto-increment IDs, and checks schema drift with Prisma.
