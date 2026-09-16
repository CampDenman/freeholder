<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Push notifications

*MASTER.md §35.1, §30 — checklist item C10.14.*

§35.1: *"Push is a notification channel, not a second notification system. The
device token is a `NotificationDelivery` channel like email and SMS (§30),
registered against the contact, subject to the same per-topic preferences, and
revoked when the session ends. A push that says something the platform would
not have emailed is a bug."*

That sentence is the design. There is no push-only message, no push-only
preference and no push-only recipient list — a push is a channel on a
notification the platform already decided to send.

## `device_tokens`

One app install that may be pushed to. Table `device_tokens` in
`0000_reviewed-baseline.sql`.

**Unique on the token, not on (contact, token).** A device token identifies an
*install*, not a person. When a phone is handed on, or a second customer signs
in on the same device, re-registration **moves** the row. Inserting instead
would leave the previous owner registered and push somebody else's bookings to
the new owner.

`contract_version` is stored so a push is never sent to a binary too old to
open its own deep link (C10.13).

## Lifecycle

| Event | What happens |
|---|---|
| App launch | `notifications.registerDevice` upserts by token and clears `revoked_at` |
| Sign out | `notifications.revokeDevice` sets `revoked_at`, keeping the row |
| Provider says "unregistered" | the row is **deleted** |

Revoked and deleted are different on purpose. A revoked device that signs back
in is recognised rather than treated as new, and an owner asking "why did this
stop" has something to look at. A dead token is deleted because §35.1 is
explicit: *"retrying a dead token forever is how a push budget disappears."*

`notifications.revokeDevice` only revokes tokens belonging to the caller.
A token is a bearer value, and letting any signed-in person revoke any token by
guessing one would be a denial of service on somebody else's notifications.
`notifications.myDevices` never returns the token itself — a customer needs to
know *which phones* can reach them, not the value that reaches them.

## Fanout

One delivery row, but a person may carry several phones. Push fans out across
every registered install and counts as delivered if **any** of them took it —
one dead handset must not mark the whole notification undelivered.

## Topics

Four new ones, and they are ordinary topics in the same list every channel
reads:

- `booking.confirmed`
- `gallery.ready`
- `invoice.due`
- `catalog.backInStock`

## The spine obligation

`device_tokens` carries a `contact_id`, so it is repointed in
`contacts.merge`. A plain repoint is safe here *because* the unique index is on
the token alone: the survivor cannot already hold the row being moved, so there
is no conflict to decide. Had the index been on `(contact, token)`, this would
have needed a deliberate decision instead of an update.

It is also registered for export and erasure. Export includes the token —
it is the customer's, not ours. Erasure **deletes** rather than revokes,
because erasure means the platform stops holding a way to reach the person's
phone, and a revoked row still holds one.

`tests/core/merge-completeness.test.ts` enforces all three by reflecting over
the schema; it failed on all three the moment the table was added, which is
exactly what it is for.

## Honest limit

There is no production push provider yet. The adapter seam
(`src/adapters/notifications`) reports itself unavailable and records a skip
rather than pretending a message went somewhere. Everything above — the
registry, preferences, fanout and the spine wiring — is real and tested; the
carrier is chosen when one is configured.
