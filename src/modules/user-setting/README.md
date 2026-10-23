# Settings and donation reminders

Authenticated endpoints:

- `GET /api/v1/user-settings/me` creates an empty setting on first access.
- `PUT /api/v1/user-settings/me` accepts any of `pickupTime`, `dropoffTime`,
  `pickupNotificationTime`, `dropoffNotificationTime` as `HH:mm` or `null`.
  Omitted fields remain unchanged; null clears a field. Unknown fields (including
  userId) are rejected. Responses return times as `HH:mm`.
- `GET /api/v1/donations/calendar?monasterySpaceId=1&fromDate=2026-10-01&toDate=2026-10-31`
  requires membership of an active monastery. Ranges are inclusive and limited
  to 366 days. Only dates with donations appear; donation dates use pickupTime,
  then dropoffTime, then createdAt. Donor names fall back to the donor user name.

All calendar days and routine times use Myanmar time (UTC+06:30), independent
of the server timezone. Settings store a fixed local date of 1970-01-01 as UTC
DateTime values. Donation pickup/dropoff fields remain full dated timestamps.
Existing settings must use this encoding to have the intended local time.

The application starts a reminder job after the database connects and runs it
every minute. Daily pickup/dropoff warnings go to the settings owner once the
chosen notification time has passed, including catch-up after a same-day restart.
Advance reminders go to the donor and monastery owners/admins/moderators (roles
4 and 5) one and two local calendar days before the donation. Only DonorList
records whose status is exactly Accepted or Scheduled qualify. Pickup takes
precedence over dropoff for both reminders and calendar grouping; undated
donations receive no advance reminder. Creation-date calendar fallback does
not imply a booking date. This module does not implement donation booking or
status changes; those workflows must populate DonorList separately.

Notification types: invitation retains 1; donation reminder uses 2, pickup warning
3, dropoff warning 4. Existing notification rows are checked in a serializable
transaction to prevent repeats for a recipient/message/local day, including
read or soft-deleted notifications. Do not hard-delete today's reminder rows.
Transaction conflicts are retried by the next job tick. No schema changes or
new tables are needed.

Firebase uses firebase-admin with Application Default Credentials. Configure
`GOOGLE_APPLICATION_CREDENTIALS` to the service-account JSON path (or use a
workload identity supported by Google). Keep credentials outside source control.
Users with an FCM token get a push after the database notification is committed.
Push failures are logged; the in-app notification remains, and failed pushes
are not retried. Users without a token still receive in-app notifications.

Myanmar month rendering/conversion remains a frontend responsibility. Optional
donation time defaults are not applied to existing donation workflows.
