<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original namespace mutation fence — source-only pre-enable repair

This is a source review finding and repair before capability publication, not
an observed production incident. The full request capability remains absent.
No compiler, lint, parser, database, native, account or provider operation was
run for this change. Root owns assembly, qualification and later activation.

The earlier namespace parent guard exempts `media_transfer_v1=1`, while ordinary
caller admission invokes the shared capability helper that sets that same
flag. A future enabled ordinary writer therefore needs a more specific fence:
a broad full-writer/recovery tag cannot grant mutation through an actual
captured drain or immutable active source-transfer claim.

The shared ordinary logical admission now checks the exact namespace under the
shared inventory fence before creating a mutating caller. Actual physical
mutation admission checks again, even when the logical caller predates the
fence. Configuration, inventory and fresh GET recovery do not grant mutation
permission. Already admitted physical requests may still retain their authentic
late facts and actual finish; they cannot be made absent by a later fence.

SQL independently protects all three stages:

- `freeholder_media_original_parent_namespace_guard()` and deferred
  `media_original_parent_namespace` check the parent at the end of the same
  admission transaction. The narrow exception requires its actual transfer
  caller and object/plan ancestry, same parent birth transaction, exact physical
  receipt, original reservation lineage, namespace, physical key, payload and
  original conditional revision. A flag or equal key does not suffice. Deferral
  permits the real shared transfer service to insert its parent and caller in
  one transaction; it does not adopt an earlier parent or current generation.
- `freeholder_media_original_mutation_namespace_guard()` independently guards
  logical callers and physical request INSERTs through
  `media_original_logical_namespace` and `media_original_physical_namespace`.
  Ordinary/multipart mutation remains refused while the namespace is fenced.
  Actual transfer mutations require the same genuine physical-receipt,
  object/plan, birth, payload and conditional-revision ancestry; a mismatched
  physical child cannot borrow a transfer object ID. GET recovery stays
  distinct and does not create an I/O privilege for a later PUT/DELETE/session.

No model, column, index, public API/MCP/SDK signature or journal is changed.
This owned-tail continuation adds two functions and three triggers. It does not
change the immutable first erasure scope, original positive observations,
caller returns, hashes or existing native control bodies. The parent/drain
serialization uses the existing shared/exclusive inventory fence without a
shared-to-exclusive lock upgrade.

Six native controls are prepared and unrun in
`tests/core/media-original-namespace-fence-lifecycle.test.ts`:

1. A cold ordinary writer is refused after an actual capture-only namespace
   drain, without provider I/O or a persisted new birth.
2. A same-key parent forged with the shared full-writer flag is refused unless
   a genuine matching transfer caller is born in that same transaction.
3. A warm real guarded logical admission is fenced at both raw SQL and actual
   factory mutation admission after capture; a fresh authentic GET still works.
4. An actual immutable source transfer claim refuses another same-key ordinary
   logical admission without provider effects.
5. Actual configured synthetic-private copy/adopt/source-retire services retain
   the genuine transfer ancestry exception and use a conditional source DELETE.
6. A genuinely dispatched paused TCP PUT retains its late actual bytes and
   finish after capture; a mismatched later physical child is refused without
   replacing those facts or mutating the original receipt.

Capture-only test drains assert no stopped executor, kernel proof or provider
support. Test tokens belong to actual new server-held infrastructure admissions;
no historical birth, ServiceContext or authorizer is fabricated. Native setup
requires the complete actual future request capability and never publishes a
fixture capability. Actual provider/platform/account acceptance remains open.

This repair is a prerequisite to reliable tracked-crash/cutover proof. Exact
independent executor stop with affirmative original nonce-bound applied bytes,
failed/unknown physical DELETE review, multipart/session retirement, quota
initialization/release recovery, cutover, translated owner recovery and full
source/database/native qualification still require completion. Actual finished
portable callers keep no Linux requirement, and a local stop plus404 cannot
prove an in-flight remote PUT will never apply.
