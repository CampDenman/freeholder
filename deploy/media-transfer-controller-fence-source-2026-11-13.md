<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Current controlling transfer ancestry — source-only correction

This finite correction descends from frozen61bf4a6b. No compiler, lint, parser,
database, native or provider/account action was run. It does not publish request
capability, claim a production incident or close any C item.

Genuine ancestry in plan A is insufficient if another current source plan B or
an unrelated executor drain later controls the same namespace. Existing shared
claim/adoption services already refuse concurrent active plans/unsettled
callers, but the physical admission and independent SQL exceptions must enforce
controller identity and phase themselves rather than assume that sequencing.

The actual logical and physical transfer admission paths now re-read the exact
object/plan, all current namespace source claims and every unreleased drain
under the inventory fence. The pure rule is used by the actual shared consumer;
it is not an unused policy label. SQL independently uses
`freeholder_media_transfer_namespace_control(uuid,text,text)` in the deferred
parent exception and logical/physical guards. Both layers require:

- The actual object’s own immutable plan, correct source/target role and current
  mutation phase. A target PUT cannot dispatch after copy phase ends; a source
  cleanup cannot dispatch before adoption or after its cleanup phase ends.
- No other live source claim controls that namespace. Historical completed or
  cancelled claims do not become a new live controller; completed source
  tombstones still independently fence ordinary writers.
- Every unreleased drain in that namespace is the source plan’s original
  `sourceDrainId`, with its exact original verified stop digest and verification
  no later than the immutable first plan. A target PUT cannot borrow that
  source drain. A new or unrelated drain is not silently adopted.

The full genuine physical-receipt/object/plan/birth/payload/conditional-revision
ancestry check now applies to transfer mutations even outside a fenced
namespace. Recovery GETs remain distinct. No models, columns, triggers, journal
or public API change; this tail adds one function and strengthens the existing
guards. TypeScript bounds its complete controller inventory at1000 entries and
refuses an oversized history rather than accept a subset.

Twelve pure controller cases and two actual infrastructure/TCP native leaves
are prepared/unrun. They cover genuine owning-plan source/target phases,
pre-admitted plan A versus another current source plan B, every live phase,
unrelated/later/additional drains, a tracked plan originally without a drain,
missing/changed stop proof, historical released/completed controllers,
wrong/ended phases and namespace/role/multipart ancestry refusal. Native leaves
use an authentic newly admitted plan A target caller and prove both raw SQL and
actual configured factory refusal after a real capture-only target drain, with
no child/bytes/receipt mutation; and prove a genuine shared second-plan source
claim refuses while that first caller remains admitted. They never publish a
fixture capability or invent a verified process stop. Existing six namespace,
seven ordinary and prior provider/capture native bodies remain unchanged.

A genuine transfer executor can crash after plan capture. This correction does
not introduce a blanket operator capture ban. An additional real drain safely
blocks mutation while fresh recovery GETs remain available. Exact authenticated
association of that additional actual stop with the current plan/caller, its
provider terminal/applied outcome and guarded release/resumption is REQUIRED
next. Neither rebinding immutable `sourceDrainId` nor ignoring the new drain is
an acceptable continuation. This dependency remains open before any capability
publication or stable acceptance.

The physical request descriptor union presently covers object PUT/DELETE and
multipart CREATE/COMPLETE/ABORT, but not browser presigned part PUT authority.
That existing signing seam needs a separate urgent conservative issuance gate
and then durable per-part/session completion/stop accounting; it is not folded
into this checkpoint and is not claimed contained by these descriptor guards.
Full multipart, failed DELETE, stopped-applied retirement, quota/cutover,
actual provider/platform acceptance and independent security review remain
open.
