# Space donations

Donation bookings use the existing `DonorList` model. No schema migration is
required. The legacy `DonationList`/`DonationType` tables are separate and are
not modified by this API.

All endpoints require a Bearer access token and membership in an active space
with an active user account. Space owners bypass permission checks; other
members need the permissions below, using their **space role**, not their
global user role. Global administrators also need space membership, consistent
with the donation calendar.

Base path: `/api/v1/spaces/:spaceId/donations` (also available through the
existing `/api/v1/monasteries` alias).

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| POST | `/` | `Space.Donation.Create` | Submit a Pending donation for the authenticated user |
| GET | `/` | `Space.View` | List this space's donations |
| GET | `/:donationId` | `Space.View` | Retrieve one donation in this space |
| PATCH | `/:donationId/review` | `Space.Donation.Review` | Accept or reject a Pending donation |
| PATCH | `/:donationId/complete` | `Space.Donation.Review` | Complete an Accepted donation |

The existing seed grants creation to space admins, moderators and editors;
review to space admins and moderators; and viewing to all space roles.
Ordinary space members must be granted creation permission before submitting.
Permission checks query active roles and permissions directly.

## Submit

```json
{
  "donationType": "Food",
  "donationTypeValue": 1,
  "quantity": "10.50",
  "note": "Lunch offering",
  "pickupTime": "2026-12-01T08:00:00+06:30",
  "dropoffTime": "2026-12-01T09:00:00+06:30"
}
```

`donationType` (1–100 characters) and `donationTypeValue` (a positive signed
32-bit integer) are required. The existing schema defines no donation-type
enum or lookup for `DonorList`; clients supply their type label/code pair.
`customDonationType`, `donorName`, `note`, `amount`, `quantity`, `pickupTime`
and `dropoffTime` are optional. Monetary amounts and quantities are positive
decimal **strings**, at most 16 integer digits and 2 fractional digits, to
preserve the precision of the database's Decimal(18,2) columns. Date-times
require a timezone; dropoff cannot precede pickup when both are supplied.

The server sets the donor ID from authentication and sets the space ID from
the URL. Supplying identity, review, or status fields in the request body is
rejected. Successful submission returns HTTP 201 with the donation in the
standard `{ success, message, data }` response envelope.

## List and review

Listing accepts `page` (default 1, maximum 1,000,000), `limit` (default 20,
maximum 100), and an optional `status` filter. Results are ordered by descending
ID and return `{ items, total, page, limit }` inside `data`. Members with view
permission can see all donations in their space.

To review, send `{ "status": "Accepted" }` or `{ "status": "Rejected" }`
to the review endpoint. The server records the authenticated reviewer and
review time. Send `{}` to the complete endpoint to record completion time;
the original reviewer metadata is preserved.

This API defines these `status`/`statusValue` pairs:

| Status | Value | Allowed next statuses |
| --- | --- | --- |
| Pending | 0 | Accepted, Rejected |
| Accepted | 1 | Completed |
| Rejected | 2 | None |
| Completed | 3 | None |

Status transitions use a transaction and a conditional update so competing
reviews cannot overwrite each other. Invalid transitions or stale status
pairs return HTTP 409. Cross-space donation IDs return 404 after membership
and permission checks; unauthorized operations return 403 and invalid input
returns 400. Existing rows with other status/value pairs are still readable
but cannot be transitioned through this workflow.

Accepted bookings with pickup/dropoff dates are picked up by the existing
donation reminder job and are visible through the existing calendar endpoint.
This workflow does not assign default booking times or add new notification
types.

## Verification

`bun test src/modules/space/tests/donation.test.ts` runs isolated service and
HTTP tests with per-test database doubles. It requires no database, Redis,
credentials or environment file and writes no persistent records. The tests
cover permissions, space isolation, request validation, lifecycle transitions,
conditional-update conflicts and error propagation. Generate the Prisma client
before running `bunx tsc --noEmit`, as described in the root README.
