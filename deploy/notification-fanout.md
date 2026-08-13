# Notification fanout and inbox operations

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder turns selected committed events into one durable notification per
logical recipient. The personal inbox is the human-facing fact;
`notification_deliveries` separately records what happened on in-app, email,
SMS and push channels. Reading or archiving an item never erases delivery
evidence.

## Delivery contract

Every caller supplies an idempotency key. `notification_receipts` stores every
accepted key, including later events coalesced into an existing live condition.
Replaying the same outbox event therefore does not increment the occurrence
count or create another delivery. A distinct event with the same recipient and
dedupe key updates the live item, increments its count and reopens it as unread.

Immediate external deliveries are claimed by `core.deliverNotifications` and
retried at most eight times with bounded errors and exponential backoff. A
ten-minute processing lease recovers a worker that disappears. Provider calls
carry the stable notification delivery ID into the mail/carrier adapter.
In-app deliveries are complete when their row commits.

Email uses the account-mail route documented in `deploy/mail-delivery.md`.
The console adapter is deliberately recorded as `skipped`, not delivered. Run
`pnpm doctor` and resolve `mail.delivers` before relying on immediate messages
or digests.

## Preferences and digests

Open **Admin → Notifications** (`/admin/notifications`). A signed-in person can
change only their own inbox and preferences; no role can inspect another
person's queue. An exact topic preference overrides the defaults:

- in-app and email default to immediate;
- SMS and push default to off;
- email alone may use daily or weekly digest mode;
- disabling in-app removes future items from the queue but does not delete the
  underlying notification or email evidence.

Digest time is interpreted in the saved IANA timezone, including DST changes.
Due rows for one recipient are claimed together and linked to a normalized
`notification_digests` batch before account mail is called. The message is
plain text, bounded, and contains internal action links resolved against
`APP_URL`. Contact-addressed notifications also snapshot the enabled Contact
locale; digest groups and catalog boilerplate use that snapshot. See
`deploy/customer-locales.md` for selection and fallback rules.

## Critical escalation

A critical item receives one escalation pass only if it is still unread and
unarchived after the personal delay (default 60 minutes). The pass reuses each
enabled external channel and has a distinct delivery kind. Reading or
archiving the item before the deadline prevents escalation; a delivered or
skipped escalation is never looped.

## SMS and push boundary

C1.15 installs the carrier-neutral contract and explicit unavailable adapters.
It does not send to Twilio or a push network. Production SMS, consent/keyword/
quiet-hour controls arrive at C7.10–C7.13; push registration and device
preferences arrive at C10.14. If `adapters.sms` selects Twilio before that
checkpoint, doctor reports the carrier as unavailable and the delivery ledger
records a safe skip. Never reinterpret that as delivered.

## Privacy, retention and recovery

Notifications addressed to a Contact participate in contact merge/undo and in
privacy export/erasure. Preference or settings collisions keep the survivor's
choice and make merge undo explicitly unavailable rather than guessing.
Archived notifications are pruned after one year; deleting a recipient
cascades their notification, receipt and delivery rows.

For a delivery incident:

1. Run `pnpm doctor`; confirm account mail and the background worker.
2. Inspect the notification and channel row, including `kind`, `status`,
   attempts, provider and bounded error.
3. Correct configuration before retrying; do not edit provider references or
   receipts by hand.
4. For outbox replay, use **Background work → Event delivery**. The receipt key
   prevents a second notification even if webhook and notification fanout
   completed on different attempts.

Migrations `0032_fancy_namora.sql`, `0033_thin_lady_bullseye.sql`, and the
locale snapshot additions in `0034_furry_ozymandias.sql` are additive. The
previous release ignores these tables/columns and remains read/write compatible
after forward migration, so rollback is an image swap. Do not drop notification
tables merely to disable a channel; set its preference or adapter to off/none
so delivery history remains truthful.
