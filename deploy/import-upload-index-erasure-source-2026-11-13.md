<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Uploaded and HTTP source index privacy: finite evidence

C1.08/C3.47/C11.14 remain open. The candidate below has ordinary-schema,
original-erasure and ownership-boundary proofs. They do not supply complete
public lifecycle, transport, provider-account, independent-review or stable
acceptance. MASTER.md §43 is the only status authority.

The frozen proof stack is acbb5f89 (ledger-domain correction), eadc139f
(historical recovery source) and b0e668ab (test-only large-later upgrade fixture).
Its exact SQL identities are:

- 80: `3a6862457f9342fe7ad109bc83c7a270ef5ac535a9b1639a459c23bc8a9c997f`.
- 81: `955a04d2f7834f11af33e6b41b1a3f1ab6d342d0d9ca78732b77d2f5ff3b5cee`.
- Ordinary journal:82 entries through index81/timestamp1793310000061. Published
  0–79 files and the prior e78380 byte prefix remain exact. Later financial
  composition requires its own combined qualification; these proofs do not
  silently transfer to another source/SQL identity.

`freeholder_current_full81_normal_v2_test_20261113` passed ordinary0–81 migration
in6.027s (8.125s runner), all82 actual hashes/timestamps,22 actual Drizzle models
(ten financial plus twelve HTTP/upload/shared-media models), named column/type/
null/default/PK/FK/CHECK/index parity and actual generated queries. All28 new81
trigger identities/function bindings/enabled/type bits/deferral checks,23
financial guards and four append guards passed. Actual scope/guard capabilities
were true; missing-original scope/projection negatives were false. UTC/fsync on/
jit off held, later inspection was enforced read-only, and clients drained.
Physical shared-media column order and Drizzle declaration order are both
recorded; exact named definitions, rather than an ALTER column's ordinal, govern
parity. SQL-only CHECKs and three deferred original-response FKs are explicit.

The source retains immutable first-fulfillment scope, including known empty;
original run/upload/chunk membership bound to retained revision and graph
identity/generation; and original chunk key digests. Current graph rows can
refuse cleanup but never fill missing membership. The exact task, verified
intact receipt, canonical holds and accepted/unresolved ownership are checked
before physical I/O. Final minimization and shared ACK use one service
transaction; a deferred completion guard checks the whole original scope.

Membership and shared media-key digests remain plain SHA256(key). Physical
receipts use SHA256(UTF8(`freeholder:media-object-key:v1`) || NUL || UTF8(key)).
Four uploaded-only joins now derive that exact ledger digest from immutable
captured chunk keys or the validated task key. The NUL is BYTEA
`decode('00','hex')`; no duplicate column, historical backfill or Crawl digest
change was made. Each indexed chunk needs an accepted original PUT with a
retirement mark and accepted DELETE in its original namespace. Unknown/live
facts, holds, later aliases/writers/rebinds and accepted ownership still refuse.

The five actual current-flow controls ran once each with their existing oracle
and deadline, bail1/retry0, disabled background workers and fresh private local
storage. Job bodies consumed actual durable tasks. Date-only expiry modelling,
where present, followed settled original PUTs; real timers and physical I/O
remained real. Elapsed time is not provider-cancellation evidence.

| Control | Source / case time | Actual result and independent readback |
| --- | --- | --- |
| Original501-WXR full erasure | acbb /6.568s | Original f1 blob4a470c34 unchanged. Completed/erased/pending0; exact initial1run/upload/chunk/graph generation/revision. Accepted PUT1+DELETE1 in the same original namespace, raw ENOENT. All501 entries, media plan/key, header/catalog and private root copies/filename minimized; marker0. |
| URL-only private media key | acbb /6.312s | Original b716 target body byte-identical. Actual owned TCP robots+HTML only, no image GET or accepted assets/batches. Completed/erased/pending0; HTTP scope1source/2responses and uploaded known-empty0/0. PUT2+DELETE2/197 captured bytes, raw2 ENOENT. Key/planned/header/catalog/entry/root marker0; safe graph/progress pointers retained. |
| Held uploaded generation | acbb /5.826s | Original847 fixture unchanged. Partially completed/retained/pending0; canonical capturev1/member1 names the exact original run/upload. Native before/after run,501-entry graph, media and canonical rows equal. Held=true; live PUT1/DELETE0;137114 retained bytes match original accepted-PUT SHA. |
| Actual accepted content child | eadc /19.209s | Same847 oracle. Actual accepted plan,500 target CMS pages, one batch and commitOrdinal500. Worker refused accepted/unresolved ownership before DELETE; original graph/index and all CMS pages equal native before/after. Verified/in-progress/pending1; live PUT1/DELETE0;137030 bytes match accepted PUT. |
| Later reviewed generation | eadc /6.511s | Same847 oracle. Captured A completed/erased/pending0 with501 entries/media/root minimized and raw ENOENT. Later actual B501-entry graph/private key/plan and bytes equal native before/after. Original membership unchanged and excludes B. PUT2/DELETE1; B's137116 retained bytes match its live accepted PUT. |

Every control has independent minimal counts/booleans, table and schema digests,
full82-journal/source hash checks and empty database-client readback. No table
row export or cloned golden was made. The ordinary v2 database was authorized
for subsequent isolated fixture resets only after each result was saved; the
preserved failing v1 and historical databases were not reset.

Local immutable proof summaries:

- `/tmp/freeholder-full81-f1-after-v3-955-20261113-verified-proof.json`.
- `/tmp/freeholder-full81-media-url-after-v1-955-20261113-verified-proof.json`.
- `/tmp/freeholder-full81-upload-held-v1-955-20261113-verified-proof.json`.
- `/tmp/freeholder-full81-upload-accepted-v1-955-20261113-verified-proof.json`.
- `/tmp/freeholder-full81-upload-later-v1-955-20261113-verified-proof.json`.
- `/tmp/freeholder-current-full81-normal-v2-summary-20261113.json`.

Historical failures remain evidence, not overwritten successes. Published-main
81271622's unchanged f1 falsely completed after deleting raw bytes while private
index text remained. Its ordinary79 containment/recovery proof is in
`deploy/import-wxr-index-privacy-2026-11-13.md`. The first composed8c SQL also
failed genuinely: domain-mismatched receipt joins kept private projections in
recovery. That populated v1 DB remains untouched. Its initial diagnostic stopped
on a shared-column ordinal assumption; a separately named read-only continuation
completed parity without schema changes. Subsequent source correction and955
qualification used a NEW database. Rejected full-row/clone preservation was
replaced by safe summaries/digests; deleted bytes are never claimed recoverable.
A URL-proof collector's obsolete key-format assumption was corrected in a
separate read-only collector, without native retry or product change.

Historical false-completed79 receipts now have a separate actual populated
upgrade/recovery proof, including the first fixture failure and truthful pending
recovery without fabricated initial capture. See
`deploy/import-uploaded-history-recovery-2026-11-13.md`.

Source qualification is finite and separate from native proof. Exact586e passed
Node22 full types/whole lint, all44 actual contract files (384 pass/26 explicit
DB skips) and nine focused assertions (nine native/upgrade gated skips).
Test-only78af passed incremental types/changed-fixture lint/four recovery pures
(one upgrade opt-in skip). Canonical637 notes, licensing2914 sources/8 manifests/
8 license texts, changelog and plan373 IDs/323 checked/50 open passed. No empty
bail artifact was counted as an executed test. Records include
`/tmp/freeholder-uploaded-history-586-actual-evidence-20261113.json` and
`/tmp/freeholder-uploaded-history-later78af-qualifier-20261113-result.json`.

Remaining native proof includes all four stronger WXR/ZIP rollback/privacy
cases; the public shared-service REST lifecycle; and the actual TCP501 lifecycle
with two independent index processes, fresh-owner accepted500-child resume,
shared PNG, publication/rollback and original default CMS preservation. The small
REST fixture mocks only the download boundary and cannot prove actual HTTP
routing. The501 fixture uses real TCP originals/media but still calls shared
services directly. Live API/MCP/SDK parity, four-locale production browser,
old-image/recovery breadth, owner/provider accounts, independent security review
and final stable sign-off remain required. No C-item is closed by these results.
