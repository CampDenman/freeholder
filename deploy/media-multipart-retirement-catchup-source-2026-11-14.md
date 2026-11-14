<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Exact-admission retirement certificate catch-up — source checkpoint

C1.12/C11.08 remain open. This finite continuation starts at frozen `7396fb54`,
which remains unchanged in its own worktree, with `000d0152` beneath it. It adds
source for durable catch-up of that existing certificate birth. All compiler,
lint, parser, collection/test, native/database, build/install, provider/account,
host and purchase actions are UNRUN. No capability is published, no model or
column is added, and the owned82 SQL and every earlier oracle remain unchanged.
No independent security, full erasure or release acceptance is claimed.

## Actual original transaction and fixed payload

The actual final idle-retirement transaction, or its existing fresh-human
lost-ABORT recovery transaction, independently derives the same complete raw
retirement payload. `captureOriginalMultipartRetirementAdmission` now queues
its six safe fields through the existing transaction-aware `enqueueJob(tx)`
primitive before returning them. The final resource retirement, exact pointer
removal, job and idempotency claim commit together or roll back together. There
is no nested `Service.call`, new business transaction, provider I/O or runtime
startup inside that helper. Existing shared-service preparation has already
prepared the resident producer before entering the original mutation.

The fixed queue data is exactly:

- original resource UUID and logical upload UUID;
- original key digest, ABORT operation UUID and inventory UUID;
- full independently derived proof/frontier digest.

It contains no raw object key, provider UploadId, URL, account locator, nonce,
credential, contact or actor. The actual queue ID lives in pg-boss and the
existing job-idempotency claim, not in supplied mutable service context. The
durable idempotency key binds operation, inventory and complete proof digest.
The private system service's six-field input is unchanged and reexported from
its previous module path. No HTTP/MCP/agent/public ABI is added.

Only the resource's **retirement event timestamp** changes from application
`new Date()` to PostgreSQL `transaction_timestamp()`, at its two actual producer
sites. Original provider acceptance, caller return, writer FIN, observed facts,
human review and other physical timestamps remain untouched, including NULL.
The helper requires that actual resource retirement happened in its current
transaction and independently derives the full exact raw proof again. A later
caller cannot enqueue a fresh admission from the current graph. This is not a
historical timestamp fill, elapsed-time stop proof or current-process adoption.

## Shared system service and genuine worker

The existing system-only `media.sealOriginalMultipartRetirement` first repeats
its entire raw proof/hold/frontier check, then validates the original queue and
claim, and only then considers certificate deduplication. It requires:

1. exact queue name `core.sealOriginalMultipartRetirement` and whole fixed data;
2. exact original job/claim relation and full-data canonical SHA-256;
3. exact original idempotency key, resource/upload/key ancestry and matching
   queue/claim/resource birth timestamps;
4. allowed durable state, plus the exact active original job ID when called by
   its actual seal worker;
5. all existing independent caller/session/inventory/hold/retirement proof.

The timestamp is corroborating transaction provenance. It never replaces the
whole proof, payload/claim hash or execution identity. A generic enqueue with
copied even-valid data lacks the matching original business claim/worker ID and
cannot create another authority. Altered queue data fails the immutable claim
hash; a new valid-looking queue at a later time cannot bind itself to old
retirement. Missing/pruned/cancelled queue/claim evidence remains recovery debt;
it is never reconstructed from current rows or used to infer completion.

The core job definition uses bounded existing retry/lease/concurrency rules.
Its consumer requires the exact `JobExecutionContext` object installed in the
actual runtime's AsyncLocalStorage scope, checks live cancellation and exact
queue name, then calls the ordinary audited system service outside a TX. The
service validates its active original queue ID in the same short transaction
as sealing. A caller-supplied equal-valued lookalike, detached old context or a
supplied boolean is insufficient. The new read-only execution-scope assertion
adds no permissions and supplies no provider admission, ACK or stop receipt.

The owner immediate `ctx.callAsSystem` path and genuine worker consume identical
six-field data. Concurrent/duplicate delivery can only reuse the same immutable
certificate while the entire original proof still matches. A new fact or hold
refuses before dedup, even if an earlier matching job/certificate exists. The
worker never sends DELETE, restarts a signer, replays provider I/O, fills an old
review/FIN or captures a new scope. It does not acknowledge an erasure job.

## Prepared controls and truthful boundary

Five structural/payload controls are PREPARED/UNRUN: exact safe data and omitted
frontier/raw-field refusal; full-proof idempotency distinction; missing installed
context and equal-valued clone refusal; detached context refusal; and actual
installed cancellation propagation. These are explicitly synthetic scope units,
not evidence that a real pg-boss worker or provider ran.

Six genuine service/managed-SDK/fictional-TCP/pg-boss controls are also
PREPARED/UNRUN, requiring both genuinely completed storage capabilities rather
than fixture enablement:

- interrupt the owner continuation after the real retirement commits; a real
  queue worker seals its exact job, with original receipts unchanged and one
  actual DELETE total;
- immediate owner sealing followed by real worker delivery deduplicates one
  certificate and preserves the first queue payload/claim;
- real newly named hold makes duplicate worker delivery refuse before dedup;
- explicitly SCRIPTED additional positive original ledger fact reopens current
  debt, retains the historical body and cannot refill the old job frontier;
- genuine generic enqueue with copied valid data is refused by its real worker
  because its job ID has no matching original retirement admission;
- inject a failure after the real transaction-aware enqueue but before commit:
  retirement, queue and claim roll back together while the separately committed
  actual provider ACK/FIN and original private pointer remain intact.

The interrupted continuation and transaction failure are local failure injections,
not OS/independent executor-stop acceptance. The late ledger fact is explicitly
scripted and does not claim another actual provider ACK or account operation.
All prior fixture/oracle bodies are preserved. All counts here are declarations,
not observed passes, assertions, skips or collection results.

## Remaining required implementation and qualification

Certificate consumers and sealed-first-identity late-positive recovery/re-review
must be proposed and completed before ANY raw minimization. The current raw
retirement derivation remains mandatory. This leaf does not update the global
legacy-false proof gate or clear provider UploadIds, request/fact/inventory/
foreign-observation locators or quota keys. Unknown/legacy/conflicting sessions,
issued/replayed/in-flight remote authorities, quota initialization/release,
capture/readback/chained cutover and actual provider/platform/portable-stop
acceptance remain required. Root owns normal integration, source/full schema,
real worker/transport/native and final security/signature gates. No C row closes.
