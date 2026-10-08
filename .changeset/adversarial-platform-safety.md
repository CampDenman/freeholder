---
"freeholder": patch
"@freeholder/sdk": minor
"create-freeholder": patch
---

Preserve date-bearing MCP tool inputs using the same schema projection as HTTP and the SDK, and return protocol errors for malformed requests instead of crashing a batch.

Validate encryption-key length and safe public origins during source-install preflight. Misconfigured origins cannot print embedded credentials in setup reports.

Serialize campaign batches and start/edit operations, and stage each recipient's message with a stable idempotency key. Campaign copies now contain a private opt-out link and one-click unsubscribe headers through the supported bulk providers. Withdrawal records marketing-email consent on the contact spine; mail already queued checks that consent again before contacting a provider. Delivery refusals update campaign outcomes through the durable event outbox.

Preserve previously sent opt-out links when contact merges deduplicate campaign recipients, including links inherited through repeated merges.

Require an explicit POST to confirm newsletter subscriptions or withdraw through a browser link, so email scanners cannot change consent by fetching a URL. Repeated provider unsubscribe requests remain safe. Lock newsletter consent transitions so an overlapping old confirmation cannot undo an unsubscribe. Actual external delivery and provider signing acceptance remain open.
