<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original provider reader runtime recovery — source only

MASTER §43 C12.38/C1.08/C9.38. This bounded source slice follows frozen c5bd1d46
and its 384439e2 suffix; neither is changed. It supplies no passing native,
SQL, type, lint, browser, provider, stable or independent security evidence.
Full §4.15/C9.33 proration and the remaining business variants stay required.

Every NEW separately admitted schedule/product verification GET now records a
normalized immutable ticket with its exact original admission, request and
resource revision digest, nonce hash and full actual process birth. The actual
process signs the admission with an ephemeral Ed25519 key. Only that process's
nonce-owned invoked wrapper can sign its real returned/thrown finish with the
same key. Its public key and signatures survive in the original immutable
database receipts; the private key never leaves process memory. Restart loses
the original signing authority and cannot manufacture a finish. These signatures
authenticate original receipt integrity within the guarded service/SQL ownership
boundary; self-generated public keys do not grant service permissions or human
review authority. No new secret store or credential rotation system is added.

An interrupted original reader blocks another GET. The owner sees its exact read
and runtime IDs, current original-evidence revision and observable liveness in
the subscription recovery panel. Review calls the shared
`subscriptions.reviewProviderReaderStopped` service: scoped management access,
fresh verification, actual signed-in person, no API-key actor and no agent stop
approval. The exact live original process birth always refuses. Same-host Linux
PID/boot/namespace/start-tick checks can establish absence. An unobservable host
requires explicit hosting evidence, the actual stopped runtime reference and
stop time, plus the typed confirmation; it is labelled an owner hosting review,
never represented as a mechanical observation. Time or heartbeat expiry alone
cannot establish absence.

Historical admissions containing only callerId retain their original sparse
provenance. No ticket or process birth is backfilled. Their original recorded
runtime identity must be tied to actual hosting logs and a stopped-runtime
review. The current process is never substituted. If the original callerId is
the current runtime's own ID, it is live regardless of sparse birth metadata.

Review creates a separate immutable signed human-stop receipt and an exact
journal projection. It changes neither the original admission nor any previous
positive fact and creates no returned/thrown finish. It leaves provider recovery
pending. All original outstanding readers must then have an actual finish or
independent stop receipt before `subscriptions.recoverProviderReader` admits a
new actual GET against the original resource. No replacement POST or automatic
new charge occurs. The existing physical creation/cancellation caller and all
money proofs remain separate requirements. Recovery works through the same
shared services on owner UI, HTTP and MCP; human stop approval remains refused
to agents/API keys on every surface. All new text is in EN/FR/ES/AR.

Late observations, actual finishes and positive-cash callbacks from a reviewed
stopped read are refused under the original ownership locks. The cash callback
uses `ctx.callAsSystem` in the same short transaction as the original read check;
there is no check/retain gap or provider I/O under that transaction. A positive
cash callback that commits BEFORE review changes the reviewed evidence revision
and invalidates stale review authority. Stop review cannot erase committed cash.
SQL additionally refuses stopped-read history additions and normalized finish
insertion. Final resource quiescence and late calendar re-consent both require
all original readers closed by their own actual finish or separate stop receipt.

`subscription_provider_read_tickets`, `subscription_provider_read_finishes` and
`subscription_provider_read_stops` are append-only normalized children. Original
journal history is append-only and bounded to 5,000 entries; signed admissions
are bounded to 128 KB, proof payloads to 256 KB, and recovery/witness inventories
fail closed above 5,000 entries. Deferred SQL constraints require each normalized
receipt's exact journal projection in the same transaction. Service readiness
requires all eight named guards/projection constraints. Cryptographic signature
verification happens in shared source helpers; PostgreSQL independently enforces
the exact immutable row/projection relationships and does not claim to verify
Ed25519 itself.

The new families participate in table ownership, buyer merge fingerprints,
privacy export, retention and search exclusions. Export projects original read,
finish and review dates; it omits provider resource IDs, process internals,
evidence text, private nonces and the other party's bank information. Immutable
financial recovery provenance has no automatic TTL; existing original agreement
erasure and financial/legal holds govern minimization. The parent subscription
owns every child, so merge repoints the existing parent contact rather than
changing an immutable admission or stop receipt.

Root additive central witness contract (the three central financial files are
untouched): `subscriptionProviderReadWitnesses(tx, subscriptionIds)` in
`src/modules/subscriptions/provider-read-witness.ts` returns
`{ tickets, finishes, stops, incomplete }`. Each child is
`{ id, subscriptionId, fingerprint }`, where fingerprint is the database row's
SHA-256. Combined children above 5,000 set `incomplete`. Root must include these
children and their bound in original merchant merge/undo evidence, alongside
the c5bd resumption receipt patch, before assembly qualification.

Owned SQL is the separate UNAPPLIED
`deploy/subscription-provider-reader-recovery80.fragment.sql`, AFTER384439e2
(after fcfe7f1b, ea555f14 and 173898e8). Root owns append composition, the NEW SQL
hash, schema/readiness metadata and a NEW normal database. No prototype, golden,
earlier fragment or existing database was changed.

Prepared controls, all UNRUN:

- Sixteen pure signed-proof/stop-authority controls: actual Ed25519 signature,
  canonical ordering, payload/domain/key substitution, exact admission ownership,
  same-key actual finish, independent stop without fake finish, foreign receipt,
  tampering, retained historical sparse provenance, live/absent/unobservable
  outcomes, required runtime evidence and stale admission/caller/revision.
- One Linux native control starts an actual independent Node child. The child
  uses the real Stripe HTTP adapter against synthetic GET responses, commits its
  real signed product-read ticket and waits inside an unresolved GET. Live review
  and replacement GET refuse; the test actually kills and awaits that original
  child, then reviews mechanical absence. Old finish stays absent, original
  facts remain unchanged, raw late history refuses, and a new actual GET must
  produce a distinct ticket/actual finish without another product/schedule POST
  or any invoice/payment. The API-key stop approval also refuses.
- The earlier late-consent native guard is tightened to require refusal of a
  replacement GET before authentic review; it no longer admits a later read
  over an older outstanding caller. All other c5bd controls remain required.

Only source inspection and `git diff --check` ran. No compiler, lint, test,
install, PG/native, generator, browser, build or provider I/O ran. The child
fixture and all 17 new controls are unqualified, not passing AFTER evidence.
Actual cross-host hosting review, schedule/product recovery business/native
coverage, SQL raw guards, contract consumers, privacy/merge integration and
owner UI/browser/accessibility checks remain required. No feature closes here.
