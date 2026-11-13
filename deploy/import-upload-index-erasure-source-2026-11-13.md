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

Two additional public-path native targets now pass on exact d25/955; their
transport scopes are distinct:

- Small REST shared-service lifecycle:6.842s (10.578s runner), original30s/
  bail1/retry0. A real fresh owner and actual services/storage stage one post,
  preserve draft/byline/taxonomy/date2024-04-02T09:00Z, publish and perform owned
  rollback. Independent root/child/source rollback, one entry+witness/content
  batch, three default CMS pages/imported0/authors0/terms0/assets0, audit actors,
  accepted PUT3/381 bytes,17 table/schema digests and all82 identities pass.
  Download bytes are MOCKED; no live HTTP/API/MCP/SDK claim follows. Retired
  private originals remain stored, so this is not an erasure proof.
- Actual TCP501/two-index-process lifecycle:52.825s (56.148s runner), unchanged
  original180s/children60s/bail1/retry0. Actual robots plus paginated REST yield
  eight original responses. Real independent PIDs646591 and646697, distinct
  fresh sessions and four total owner sessions prove0→500 then500→501/catalog.
  Both child results record transportCalls0 and unchanged full journal. The
  resolved globalSetup=[] guard ran before child start; no reset/migration/seed
  or original HTTP refetch occurred. Child result directories remain preserved.
- The actual shared PNG was fetched once, with no outbound cookie/authorization.
  An accepted500-page child resumed under a fresh owner session and committed
  one final page; replay was idempotent. Native501-draft→501-published→owned
  rollback, exact original default CMS snapshot, asset usage0 and in-process
  media-route200→404 assertions passed. This uses real outbound TCP and shared
  services; incoming HTTP API/MCP/SDK and browser acceptance are not implied.
- Independent final readback: root plus three children/source rolled back;
  graph invalidated/commitOrdinal501,501 entries and original witnesses, one
  media batch plus content500+1; default CMS pages3/imported0/asset1 trashed.
  All eight private originals'171035 bytes match file hashes/sizes and exact
  namespace-bound accepted PUT receipts. PNG102 bytes match asset checksum and
  accepted PUT;11 accepted PUTs include derivatives. Private originals remain
  retained/retired. Seventeen table/schema digests, all82 source/journal hashes,
  UTC/fsync on/jit off/read-only profile, exited child PIDs and PG[] are saved.

Public proof records:

- `/tmp/freeholder-full81-public-rest-small-v1-955-20261113-verified-proof.json`.
- `/tmp/freeholder-full81-public501-two-process-v1-955-20261113-verified-proof.json`.
- `/tmp/freeholder-full81-public501-two-process-v1-955-20261113-raw-original-receipt-bindings.json`.
- Child directories `/tmp/freeholder-crawl-index-process-maDA8X` and
  `/tmp/freeholder-crawl-index-process-vXgbds` retain actual results/logs.

The four stronger WXR/ZIP rollback/privacy cases now pass on exact ce876afe/
b99dfd3b/955. Each selected exactly one actual case, with its original60s deadline,
bail1/retry0 and a fresh private filesystem. Existing assertions were unchanged:

| Source | Late reader and rollback | Named hold, rollback and release |
| --- | --- | --- |
| WXR |6.939s case/8.733s runner |7.356s case/9.137s runner |
| ZIP |7.574s case/9.387s runner |7.366s case/9.184s runner |

Both late-reader cases refuse the actual in-flight reader-bearing result and
preserve original entry IDs, ranges and digests. After owned rollback, the real
original task completes erasure: all500 entries minimized, private marker0,
verified/fulfilled completed request and intact erased receipt/pending0. Readback
proves exact initial run/upload/graph-generation/revision/one-chunk capture,
plain key digest, exact current task and retired projection predicate. Accepted
PUT+DELETE share the original namespace/digest; WXR143854bytes and ZIP108396bytes
are gone from private storage. All82 journal hashes and read-only UTC/fsync on/
jit off profiles match; every case drains clients before another owned reset.

Both held cases prove that the exact named hold retains the original through
rollback, generic cleanup refuses it, and deletion succeeds only after that
specific hold is removed. Their final actual state is narrower: holds0/raw
ENOENT with accepted same-namespace PUT+DELETE, but all500 index entries remain
unminimized with one private marker row. The original intact receipt remains
partially completed/retained/pending0 and has no current erasure task. The
captured graph is eligible for retirement; eligibility is not minimization or
ACK. These tests make no post-release completion assertion. Same-request resume
and the final retained index/receipt lifecycle remain open.

Aggregate evidence is
`/tmp/freeholder-strong-wxrzip-four-actual-verified-summary-20261113.json`
(SHA256c316cd05b5b3e854b1a25ec62b91d7682bc12f2671ea1406ec1e50955c0b910d).
Per-case files are `freeholder-strong-wxr-unparsed-v2`, `wxr-held-v1`,
`archive-unparsed-v1` and `archive-held-v1`, each ending
`-955-20261113-verified-proof.json` under `/tmp`.

Two operational diagnostics are preserved without native retries. An initial
anchored reporter-name pattern selected zero tests: Vitest5.0.5 matches suite
and title separated by ` > `, while its JSON reporter uses a space. No pass was
credited; all17 prior lifecycle table digests/82 journal entries remained exact.
The first read-only collector incorrectly required one source task globally;
pgboss retains three older-request tasks outside truncateSpine. Independent
classification found exactly one current-request task. An authorized new-named
collector filtered that exact request and passed without rerunning the native
case. Product/tests/SQL and all original oracles were unchanged.

Seven other small REST authority/cancellation/recovery cases remain unselected.
Live API/MCP/SDK parity, four-locale production browser, broader old-image and
record/recovery coverage, final combined-source qualification, owner/provider
accounts, independent security review and stable sign-off remain required.
No C-item is closed by these finite results.
