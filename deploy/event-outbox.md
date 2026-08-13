# Event-outbox operations

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder writes every service event to `outbox_events` inside the mutation's
transaction. The event therefore commits with the business change or not at
all. Delivery happens after commit and is recovered by `core.dispatchOutbox`
when a request or process disappears.

## Delivery contract

Boot gives every manifest listener a stable ID in the form
`<module>:<event>:<exported-handler>`. `outbox_event_deliveries` holds one
receipt for every event/listener pair. A receipt moves through:

```
pending -> processing -> delivered
                    \-> pending (bounded retry)
                    \-> dead_letter (attempt 8)
```

Workers atomically claim a receipt and hold a five-minute lease. A second
worker cannot execute the same live claim. An abandoned `processing` receipt
becomes eligible when its lease expires. Failures use exponential backoff,
retain a bounded error message, and stop after eight attempts. An event with no
registered listener follows the same bounded policy and dead-letters instead
of disappearing as successfully dispatched.

The event is `dispatched` only when every receipt is `delivered`. One dead
receipt makes the event a `dead_letter`. Delivered events are pruned after
seven days; dead letters remain for 90 days so an owner can diagnose and
recover them. Database backups must contain both outbox tables.

## Duplicate-safe replay

Open **Background work -> Event delivery** (`/admin/jobs/outbox`). Staff with
`platform` view access can inspect statuses, errors, timestamps and recursively
redacted payloads. Agents and API keys cannot read this cross-module ledger.

After fixing the listener or configuration:

1. Open the dead-letter event and inspect every listener receipt.
2. Confirm that the underlying cause is repaired.
3. Complete step-up authentication.
4. Type `REPLAY` exactly and submit.
5. Verify that the targeted `core.dispatchOutboxEvent` run and event settle.

Replay resets only `dead_letter` receipts. A receipt already marked
`delivered` is immutable and its listener is skipped, which is the durable
proof that operator replay cannot repeat an already completed listener side
effect. The reset, audit row, replay event and targeted job enqueue share one
transaction; an idempotency key containing event ID and replay generation
prevents duplicate recovery jobs.

The built-in webhook listener passes the outbox event ID into fan-out. A
partial unique index on `(subscription_id, outbox_event_id)` prevents a replay
or crash recovery from creating a second external delivery. The receiver also
gets the stable webhook delivery ID in its signed body and header.

No database can make an arbitrary third-party API atomic with its own commit.
Custom listeners that call an external provider must use the supplied
`EventDeliveryContext.eventId` as that provider's idempotency key (or write a
transactional local delivery record first). A crash after an unkeyed provider
accepts work but before the receipt commits remains unknowable and is not
misrepresented as exactly-once delivery.

## Failure checklist

1. Run `pnpm doctor` and confirm the job worker and database are healthy.
2. Check whether the listener named on the receipt is still registered. A
   renamed manifest, event or export is a contract migration, not a cleanup.
3. Correct code, credentials or configuration before replaying. Replaying a
   deterministic failure only spends the next eight attempts.
4. Do not update receipt rows by hand. Use the audited recovery service/UI so
   completed receipts remain preserved.
5. If a receipt is stuck in `processing`, let its five-minute lease expire.
   The ordinary sweeper reclaims it safely.
6. Preserve dead letters in backups and restore drills. Never prune them early
   merely to make the warning count disappear.
