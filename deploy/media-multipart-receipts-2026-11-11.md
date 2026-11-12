<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original multipart operation qualification

C1.12 and C11.08 remain open. This source increment preserves original private
S3 multipart uploads while recording CREATE, COMPLETE and ABORT independently
from ordinary object PUT/DELETE receipts. Original resource binding, logical
reservation owner and ordered completion parts are immutable. Physical provider
calls happen after short reservation transactions; positive acknowledgements
are recorded before further inspection. Unknown calls are not blindly retried.
ABORT retirement requires original ListParts absence and no completed object.
Lost CREATE replies require a complete exact-key multipart inventory, with
fresh stopped-writer and original-provider evidence supplied by a person.

Local evidence on 2026-11-11, using synthetic private providers and disposable
Postgres only:

- Actual main72 completed an upload through a replacement provider namespace;
  its original before control failed. The replacement refusal and supported
  cancellation after controls now pass together (2 tests, 13.30 seconds).
- Unmodified root75 WIP completed customer erasure while a proxy request was
  paused in its scanner, then made one new physical PUT after erasure. That
  exact before control failed in 9.60 seconds. The unchanged after control
  passes in 7.15 seconds with completed erasure and zero new physical PUTs.
  This attribution is to the root75 checkpoint, not a separate main72 proof.
- Six adapter controls pass: no hidden CREATE retry, HTTP200 embedded COMPLETE
  error, positive COMPLETE ACK followed by failed HEAD, empty-open versus
  NoSuchUpload, full paginated exact-key inventory and malformed inventory.
- Full typecheck and lint passed. Static contracts pass all 42 required files,
  380 tests plus one explicit exclusion; playground policy and private-service
  inventory also pass. Journal75 is intentionally not changed in this branch.
- A fresh official migration chain through74 plus explicit unpublished75 SQL
  succeeded. This is not contiguous journal75 upgrade qualification.

The subsequent composed increment adds immutable `media_erasure_cohorts` rows
containing only an original request/scope and one source receipt/resource UUID.
They precede minimization and preserve the authority needed when a late positive
provider fact contradicts completed erasure. Original minimized identities are
not restored from a current email or executor. A person supplies an original key
matching its immutable digest; a fresh physical cleanup witness carries it.
Provider facts commit before the shared `privacy.reopenErasureJob` transition;
bounded idempotent reconciliation revisits unfinished facts after a crash.

Composed local evidence, still without a journal75 claim:

- Original PUT/DELETE native coverage passes all 13 controls together in 108.52s.
  Two old race fixtures explicitly use guarded test transactions; erasure also
  acknowledges the newly added reservation scope instead of assuming one job.
- The late-PUT/completed-erasure before control fails against unchanged root75
  in 8.63s. Its after control passes in 11.48s and again in the composed pair.
  It verifies reopening the exact request/artifact, refusing a different key,
  deleting original bytes and minimizing every resulting receipt before the
  request completes again.
- The minimized original multipart CREATE control passes in 10.22s: a late
  allocation/ACK reopens original erasure, known original inventory can be
  reviewed, and verified ABORT retirement completes its original job. The first
  composed attempt did not enter this case because the 25s truncate statement
  deadline fired (PostgreSQL 57014); only that affected case was repeated.
- Live SDK generation passes all 8 controls in 3.02s and updates the two public
  multipart recovery methods and original-key recovery input.
- A normal production build of genuine pre75 main74 commit
  `0ccf3b0b7654e3367e87c990ee3fa8738994824b` passes its standalone scrub:
  20,440 files / 246,699,356 bytes, Node 24.15.0. BUILD_ID SHA256 is
  `d50d1ef23bf32a5559790de9821c52ec3c5f56c73444f7de68f1b13beb7fb538`;
  standalone server SHA256 is
  `c31a4d2f7f21cd7139dcc786055d684f3aca512c56689bba1f31fce5d7221da2`.
  The identical actual artifact has readiness 200 and a successful authenticated
  normal HTTP upload with one synthetic S3 PUT against official 74 (1.81s).
  Against explicit75, readiness is 503 and the same valid upload is refused,
  with zero physical provider calls and unchanged media witnesses (3.04s).
  Both use the documented pre-migrated runtime option; no guard or artifact is
  patched. Servers are stopped and drained. This is a local build, not signed
  release or provider-account acceptance.

Capture followup preserves declared logical ownership beside physical receipts,
binds stored reads/derivation to accepted original bytes, and retires only exact
subject-owned capture and attached-asset pointers through shared erasure/purge
composition. Social's two stored-adoption producers use the same PUT ledger.
Both named media hold scopes propagate to the owning physical records. The
directly affected final 13 controls pass together in 98.72s across four files:
capture 5, staged-raster 3, published-asset erasure plus both named hold scopes 3,
and social accepted/failed adoption 2. Thirty unrelated cases were deliberately
unselected. The known subject's bytes and metadata retire while an unrelated
owner recording/library asset remain intact. Full fast gates also pass.

One subsequent peer-COMPLETE control uses S3-conformant semantics: there is only
one materialization, and the gated peer receives HTTP404 NoSuchUpload after the
original call finalizes the resource. Original publication correctly succeeds;
its resource ID, positive ACK and immutable parts remain unchanged. The first
probe fails in 10.22s only because this in-progress recovery implementation
could not reconcile the refused peer as not-applied while the original object's
bytes existed. The bounded repair allows that decision only with no ACK on the
peer, another positively acknowledged/verified COMPLETE on the same resource,
and current full bytes matching its independent accepted receipt. The after
control passes in 12.07s; final live SDK8 passes in 3.22s with no additional
artifact drift. This is a compatibility defect in the unfinished repair, not an
original-main publication failure or a second effect excluded by S3's contract.

The temporary direct-abort refusal in root75 WIP was a compatibility regression
in an unfinished repair. Original main72 cancellation worked; it is not counted
as a preexisting launch defect.

Further qualification remains for four-locale owner browser acceptance and
contiguous upgrade on the final composed source.
Breaking migration75 requires actual old direct
writers to stop and drain. Readiness refusal cannot stop an already admitted
network request. Cross-target adoption/source cleanup, live storage acceptance
and independent review remain explicit completion dependencies.
