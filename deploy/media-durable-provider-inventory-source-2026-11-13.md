<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Durable original provider inventory source checkpoint

C1.12/C11.08 remain open. This isolated checkpoint continues frozen `d0a90dd3`
and includes the optional provider foundation separately frozen at `e20f69da`,
plus generation-pinned original reads. The conservative ordinary-media
containment separately frozen at `0924de7f` is composed here. No compiler,
lint, collection, test, PostgreSQL/native, build, install or provider-account
operation ran. No actual account policy, production retention incident, source
completion, independent security review or launch acceptance is established.

## Fail-closed activation and migration boundary

The owned `deploy/sql/0082_verified_media_transfer.unapplied.sql` remains an
unapplied tail. Root owns final migration/journal assembly and a genuinely new
database. The existing0–81 migrations/journal are unchanged. This checkpoint
adds five models to the ten original transfer models and registers them in
core tables and `media.storageTransfers` privacy/retention coverage:

- `mediaStorageTransferRequests` / `media_storage_transfer_requests`
- `mediaStorageTransferRequestObservations` /
  `media_storage_transfer_request_observations`
- `mediaStorageProviderInventories` / `media_storage_provider_inventories`
- `mediaStorageProviderInventoryPages` /
  `media_storage_provider_inventory_pages`
- `mediaStorageProviderInventoryEntries` /
  `media_storage_provider_inventory_entries`

The new request capability is **deliberately not defined**. Runtime requires
its exact `verified-original-request-inventory-v1` value in addition to the
original transfer capability. A placeholder/alias must not be introduced to
activate this intermediate source. Known adopted histories cannot fall back
to a current source because the complete capability is missing. Root must
finish recovery/ordinary read and writer integration before publishing it.

The new session writer ABI additionally requires
`freeholder.media_transfer_requests_runtime_v1=1`. Both cold and already-open
older transfer sessions lack it and are fenced by SQL before admitting a media
intent. This is a writer ABI, not protection from a database owner. It is not
stop proof for already-admitted network work. Deployment must actually stop
and drain old executors; unknown remote legacy work remains explicit debt.
A Linux/systemd witness is not required for a newly tracked, actually finished
cohort. Exact tracked-crash executor proof is unfinished.

## Written source behavior

New ordinary S3 PUT callbacks retain their actual response ETag/version when
available. Replit retains the actual non-resumable upload result's generation
and pins full untransformed readback to it. Missing provenance stays debt;
older rows receive no birth/protocol/revision backfill. The hosted quota
wrapper now forwards the actual ACK callback and protocol metadata instead of
dropping them. Ordinary cancellation, retirement and absent recovery remain
conservatively blocked; adding collectors does not reopen them.

Each transfer object-provider invocation has a server-held admission token,
original descriptor/digest and runtime identity committed before I/O. Actual
response, metadata/body facts, positive ACK and actual finish are separate.
Dependent erasure hooks run only after the original request facts and finish
are committed, so a hook failure cannot discard already returned metadata.
Closing the scope refuses new requests. An actual late original positive fact
can still append and revoke retirement, restore its exact pending physical
pointer and reopen the same original erasure lineage. It does not restore
personal identity or replace the first result. Unknown writes are not retried.

Complete provider inventories have immutable headers, original page/cursor
chains, resource identities and original entry/membership digests. Two complete
passes must agree. The private shared services bind each page to its exact
actual finished request/caller, original namespace and returned result. Whole
source inventory must agree with the immutable original provider revisions;
a later equal key, byte count, ETag or body cannot supply missing provenance.
Source identity is checked before target PUT. Target pre-existing resources are
preserved and capacity reconciliation compares the complete physical byte
inventory. Unknown sessions, versions, incomplete pages, changed policies,
corrupt captures and missing original results block progress.

Source conditional retirement requires a fresh adopted-target byte witness,
actual original conditional DELETE and complete provider version/session
absence afterwards. A current404 alone cannot complete it. Erasure reads and
deletes pin the actual original provider generation. If no original target PUT
was ever admitted, foreign bytes at the proposed target key stay foreign:
there is no target read, adoption, DELETE or invented absence receipt. If a
PUT was admitted, missing original target facts block rather than rebind it.
Both admitted physical sides need complete absence inventory before ACK.

Privacy keeps stable original membership and first proof digests. Subject
exports include only proved original resource attribution, not foreign global
inventory. Request descriptors and individual raw facts can be minimized only
after exact captured physical lineage retires. Leaf/membership/key/resource
digests survive scoped locator minimization. Unknown request debt and holds
prevent minimization. Only explicit original receipt IDs and actual admitted
copy receipt IDs are retired; equal keys in other namespaces confer no scope.

## Prepared controls, not qualification

New declarations in this slice: 13 provider protocol controls,11 inventory
projection controls, four immutable-source-result controls and four actual
PostgreSQL/shared-service controls. The native controls prepare cold/warm old
ABI refusal, one genuine new local fixture writer, and an identical foreign
target collision preserved without target requests while the original source
retires through real TCP and complete inventories. These are not actual
provider-account or authenticated HTTP/MCP acceptance. Original d0 test/helper
files and all their assertions remain byte-unchanged. The existing original
TCP helper lacks new inventory responses; a separate prepared helper supports
those responses. Older native positive cleanup/text-only recovery expectations
are preserved BEFORE contracts and are not claimed green AFTER containment.
There are no observed pass, skip or nonempty assertion counts.

## Remaining implementation before activation

1. Complete ordinary-media per-request/session accounting and actual recovery;
   replace its conservative gate only with original durable proof. Complete
   multipart original-result collection and safe quota retirement/ACK handling.
2. Complete exact tracked-crash executor stop receipts and close original
   subrequest debt through independently valid actual return/stop and fresh
   provider proof. Never treat text, timeout, empty list or HEAD404 as a stop.
   Unknown legacy remote cohorts require their original proof, not backfill.
   The inherited transfer caller identity still reads Linux proc metadata;
   portable known-finished identity and pluggable provider/container executor
   witnesses remain required before activation. No non-Linux proof is claimed.
3. Finish human original-provider recovery for unknown outcomes without adopting
   a later current generation. Complete pinned adopted reads outside transfer
   phases, cancellation/chained transfer and final deployment/CLI packaging.
4. Finish and independently qualify every SQL guard, privacy/minimization
   control and final exact capability. Assemble the final candidate and fresh
   normal82 database; run source/native/transport/SDK/provider acceptance with
   preserved BEFORE failures and independent scoped proofs. No old database
   may be reset or migrated for this work.

These are required unfinished work, not new deferrals. Main containment and
this checkpoint must be integrated deliberately: the full slice includes its
product gate and the provider primitives, while the independent frozen commits
remain review/provenance references. Do not blindly apply overlapping source
commits twice. No root financial central file or dependency descriptor changed.
