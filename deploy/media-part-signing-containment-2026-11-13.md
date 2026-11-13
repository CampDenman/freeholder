<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Durable part-signing authority containment — C1.12/C11.08

The implementation was frozen source-only at3e722c90 on protected-main
basefe2645dc. Actual component qualification is recorded below; no real
provider/account or deployment operation was performed. It is independent of the unqualified media82 stack,
adds no schema/migration/model/public signature and publishes no capability.
It does not claim an observed production incident or read any account default.

`signUploadParts` grants browser PUT authority when it returns a presigned S3
part URL. An open provider session, an unexpired reservation, current404 or a
generic storage-request capability does not prove durable per-part admission,
actual caller/session finish or later physical retirement.

The existing shared `media.signUploadClaim` keeps its ownership/privacy/state/
part-range checks, then refuses unavailable durable part authority BEFORE any
upload state update. The orchestrated `media.signUploadParts` rechecks that
same authority at its signer handoff. UI, dedicated HTTP, generic HTTP, SDK and
MCP reach these same permission/audit paths; no separate signing shortcut or
mocked authorizer is introduced.

The gate requires the specific function
`freeholder_media_original_part_capability_v1()` to return
`verified-original-multipart-part-authority-v1`. No such function is supplied
here. Generic media/request capability alone can never enable this path. The
complete future implementation must supply actual durable part/session
admissions, physical mutation/byte accounting, real finishes or exact verified
stop, unknown-outcome recovery and conditional retirement before publishing it.
Neither a fixture flag nor an owner statement supplies this authority.

Existing sessions, original receipts and holds remain intact. The gate sends
no PUT, ABORT or DELETE, and creates no new signed URL. The recovery screen
explains the restriction for open sessions in English, French, Spanish and
Arabic. It does not advise expiring or deleting the evidence to retry.

Two actual shared-service/TCP negative controls are implemented in
`media-part-signing-authority-lifecycle.test.ts`. The real private S3 adapter
performs CREATE against a fictional loopback HTTP provider, so its session and
first receipt are authentic. For created and already-uploading metadata states,
the actual owning user calls the real shared service. A spy wraps the real
configured S3 `signPart` function without changing its implementation. Both
controls require a protocol refusal and zero signer calls, no provider request,
no URL and byte-identical upload/object/resource/operation rows; the original
open session remains present and unretired. The uploading branch changes only
fixture metadata after genuine CREATE, not physical caller/provider evidence.
No capability is enabled, ServiceContext fabricated or authorization mocked.

The existing large-file assembly test’s BEFORE blob is preserved by the base
commit and freeze manifest. Its signing expectation alone now asserts this
explicit authorized refusal; its fixture already supplies a provider-held part,
so all subsequent assembly, original receipt, asset and idempotency assertions
remain unchanged. This is an intentional new operational restriction, not an
unexplained failure or a weakened completion oracle.

Previously issued URLs remain outstanding authority until their actual
provider/session protocol proves retirement. A new code gate cannot revoke
old presigned URLs or an old running binary that still holds a signer. Actual
rollout must replace/drain old application runtimes and retain their authentic
session/caller evidence. Expiry, empty lists and current404 alone do not prove
that bytes or admitted writers are gone. No such rollout/stop/provider proof
is claimed here.

Full per-part/session provenance, recovery and physical erasure remain required
before stable. The passing component qualification below does not supply
protected green CI, full-protocol or real provider/platform acceptance.

## Actual component qualification at3e722c90

The exact signed implementation passes full TypeScript46.183s, all affected
TypeScript lint6.673s and the repository license/notes/plan gates. Existing
isolated dependency bytes were reused only after all12 workspace/lock
descriptors matched (the donor’s build8GB script is the sole semantic script
difference); no dependency install or owner configuration was used.

A fresh database applied all80 published migrations normally in5.315s. Every
journal identity/hash equals the existing frozen published baseline. The new
part authority remains absent. Each actual case ran in its own process, with
an independent read-only proof before the next reset:

| Actual journey | Seconds | Result |
| --- | ---: | --- |
| Open created session refuses signing | 10.528 | Real S3 signer0; original rows/session unchanged |
| Existing uploading session refuses signing | 7.523 | Real S3 signer0; original rows/session unchanged |
| Existing private-S3 completion/validation/idempotency | 7.976 | Original completion assertions pass; one asset attached to the same completed upload |

The first two use an actual loopback TCP fictional provider and configured S3
adapter; the older completion case keeps its existing fictional HTTP edge.
None supplies real provider-account acceptance. All three independent proofs
retain minimal table counts/full-row hashes, no financial rows, all80 journal
hashes, UTC/read-only/fsync/jit profile and no open database clients. Frozen
local evidence prefixes are /tmp/freeholder-part-signing79-source-v1-20261113,
/tmp/freeholder-part-signing79-normal-v1-{manifest,result}-20261113.json and
/tmp/freeholder-part-signing79-{created,uploading,assembly}-native-v1-20261113
(-result.json and -ledger.json). The original BEFORE blob and single signing
expectation diff remain preserved. Protected review/green CI, old-runtime and
issued-URL retirement, complete per-part support, real provider/platform
acceptance and stable sign-off remain open.
