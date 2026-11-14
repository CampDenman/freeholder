<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Genuine managed producers and explicit diagnostic probes

C1.12/C11.08/C12.36/C8.07. SOURCE ONLY from `a7999889`. No types, lint, parser,
model imports, migration, tests, provider/account or executor actions ran. Four
boundary pure cases and six real-service/TCP native cases are PREPARED / UNRUN.
All full request and multipart-part capabilities remain UNPUBLISHED. Existing
original positive/oracle/helper files remain unchanged; this does not qualify
source, business flows, an actual provider or a hosting platform.

## Physical producers

`members.uploadSealedBlob` keeps its actual membership/conversation/MLS checks,
claims an original media reservation in the same real short transaction, sends
ciphertext through `putWithReceipt`, then confirms only the exact original
reservation, provider result/nonce and actual FIN or guarded affirmative review.
Only ciphertext is hashed for storage integrity; no plaintext, MLS key, name or
message secret is retained by the original physical receipt. Participant reads,
single attachment and unsend semantics stay with the existing shared services.
The module's existing live/abandoned lifetime protects its pending media pointer.

`member_sealed_blobs.original_reservation_id` is nullable with NO DEFAULT; old
rows remain NULL. New claims bind their actual same-transaction reservation,
real owner contact and exact bytes/key. SQL refuses identity rebinding/backfill,
ready-without-original-proof and forgetting before verified physical removal.
A genuinely unused reservation can be abandoned under the existing exclusive
original-key checks: no writer/session was ever admitted, the pointer is gone
and the logical blob is actually due. This never invents FIN/remote absence.
Named holds preserve even unwritten metadata. Actual retirement remains exact
conditional removal/full inventory proof, followed by guarded record removal.
No FK points at the disposable pending pointer: the durable original UUID is
checked against immutable physical admissions rather than blocking retirement
with a circular pointer dependency. One unique reservation index is added.

Legacy personally owned opaque blobs with NULL birth are NOT rebound to a
current equal-key media record. Members account erasure explicitly refuses
completion while such records need original storage recovery, keeping owner
links and private evidence. The purge cannot silently forget them. This is a
conservative pre-enable operational restriction, not complete legacy untracked
writer recovery; actual old-account/stop/physical provenance remains required.
No old erasure capture/header is filled or expanded by this change.

Gallery archive building retains its authorized system source/apply services
and delivery-policy digest. A new private system claim reserves one stable
original pending physical generation per exact gallery/policy/ZIP digest. A
retry reuses that real immutable reservation; conflicting/missing births refuse.
A genuinely later generation gets a new UUID/key after the old pointer retires;
permanent old-key tombstones are never removed. The original bytes are stored
through shared caller/nonce/FIN admission before the current output pointer can
be published. Stale generations retain their actual receipts for shared orphan
cleanup. The download filename remains the gallery slug plus `.zip`.

Gallery delivery work remains business-owned, as its existing privacy policy
requires. Customer erasure strips links/credentials while the business retains
the work; this change does not adopt business bytes as the current customer's
resource. Old raw archives retain unknown original provider lineage and require
real transfer/recovery provenance; equal content does not supply old birth.

## Final application boundary

The configured application `storage()` facade now refuses raw PUT, DELETE,
multipart CREATE/COMPLETE/ABORT and part signing. Real ordinary producers supply
the actual original observer, active server-held scope and committed caller
token/role/key. The provider's physical observer/SQL gates still independently
bind its namespace, immutable request and tombstone before I/O. Missing or forged
context does not reach the provider. Reads are unchanged. Quota reservation sits
inside this outer guard. Low-level operator/test provider factories retain their
explicit contract; none of the three audited application producers uses them
as an untracked mutation escape. Original transfer/retirement drivers already
use their own genuine accounted caller scopes.

Part URL issuance remains unavailable at this final boundary because genuine
per-part admission/replay/in-flight revocation is unfinished. The separately
protected service-level part containment MUST remain merged. This is containment,
not implementation of the remaining multipart feature, and no generic flag
publishes signing authority. Already issued URLs/old binaries are not revoked
by new source; their actual original session/caller debt stays explicit.

## Doctor: read status or explicitly run a probe

Source review confirmed the old `platform.doctor` query performed a real storage
write/delete from GET `/api/doctor` and SSR `/admin/health`, inside a service TX.
The public old name and all existing health/read scopes now remain a passive
query. It reads environment/database/timezone, payment/notification configuration
and retained grant debt and explicitly warns that no provider/storage probe ran.
Opening the page, GET, `/api/health` and Linux status do not run the mutation.
A configuration-only result does not claim the provider accepts real writes.

NEW `platform.probeDoctor` is a scoped manage mutation/orchestrator. It writes,
verifies and conditionally retires its real diagnostic file outside business
transactions through the same original media protocol. Separate private
`platform.authorizeDoctorProbe` and `platform.recordDoctorProbe` phases audit
the actual invoker and completion without retaining credentials/provider bodies.
The `runDoctor()` real roundtrip implementation and original positive test bodies
remain intact; its caller can now supply the actual authorized Actor.

POST `/api/doctor` uses `serviceRoute` (real principal, CSRF, permissions, error
mapping). The CLI explicit `scripts/doctor.mjs` command uses POST and echoes its
real session CSRF cookie; a bearer key needs a separately granted
`platform.probeDoctor` or intentionally broad platform scope. Existing health-key
profiles retain only passive `platform.doctor`; no old read credential silently
acquires a new write right. The admin page has an explicit manage-only submit
with en/fr/es/ar guidance and actual returned results. MCP/OpenAPI infer read-only
status versus mutation from the real catalog. Root must regenerate/check SDK
and qualify genuine issued-key HTTP/MCP/SDK/admin/CLI probe/refusal behavior on
the final combined catalog. No generated SDK was changed on this older branch.

## Qualification and remaining work

Prepared native cases use a fictional owned private TCP provider and real shared
services/MLS devices: opaque upload/decrypt/participant refusal/unsend/conditional
purge with original nonce and nonempty physical FIN assertions; lost PUT reply
stays pending without confirm/rebind/replay; SQL rejects a changed original
reservation; real proxied document upload and system gallery ZIP creation;
passive old read scope versus explicit audited Doctor mutation; and raw managed
PUT refused before provider I/O. The role/scope Actor fixture is a bounded service
policy test, NOT genuine key issuance or transport acceptance. No auth provider,
ServiceContext, kernel stop or request capability is mocked to claim acceptance.

Before qualification, root must assemble the corrected owned tail into a NEW
ordinary database, update the existing member model/index/trigger/function
parity contracts, and preserve every old failed DB/oracle. An actual populated
pre-82 upgrade must prove old sealed rows stay NULL, updates cannot add birth
and their erasure/forget stays pending; new real claims must acquire the field
through the genuine service. Native positive controls depend on the genuinely
complete published request protocol; no temporary ABI is authorized.

Existing local/provider fixtures that directly call application `storage().put`
to seed bytes will now hit the deliberate raw-mutation refusal. Preserve their
original assertions/BEFORE blobs; when actually qualified, migrate only setup
to real shared admission or explicit low-level owned-provider fixture seeding.
Do not bypass the new fence or replace actual business positive calls with fake
contexts. Local filesystem is synthetic/test-only and is not actual provider
acceptance or a replacement for production private storage.

Remaining full request ABI prerequisites: full multipart/session/orphan/part
provenance and replay/in-flight terminal guarantees, exact physical quota release,
capture/stopped/chained privacy/cutover journeys, real untracked legacy recovery,
complete source/schema/native qualification and actual operator/provider/platform
acceptance. Independent C11.10 review and final C11.17 signature remain open.
