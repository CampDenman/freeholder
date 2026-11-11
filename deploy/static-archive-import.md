<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Static website ZIP imports (C3.22)

An owner can select **Static archive** in `/admin/imports`, upload a ZIP,
review staged pages and omitted files, resolve existing page conflicts,
commit editable CMS drafts, reconcile, publish and roll back. Existing shared
import services provide the same permissions and original-actor audit to the
owner UI, HTTP, MCP and SDK. An empty conflict slug addresses the home page.

The archive supplies actual HTML titles, content, metadata and relative URL
identity. It does not manufacture WordPress authors, comments, taxonomies or
feed/query aliases. Images, video, audio and document references become typed
CMS blocks backed by local assets. Credentialed and executable links are
rejected before rewriting. Literal percent filenames retain their identity;
entry names are never URL-decoded into other entries. Old-file redirects use
the business's default language; explicit language URLs retain their language.

## Bounds and private ownership

`src/core/import/archive.ts` reads ZIP ranges without filesystem extraction.
Bounds are 2,000 entries, 100 MiB compressed or expanded data, 500 pages,
20 MiB combined HTML, 2 MiB per page, 500 media files and 25 MiB per media file.
Path depth is 20; ZIP decoding has a 60-second budget excluding provider upload
time. Traversal, absolute/backslash/control paths, symlinks, special files,
encryption, case/Unicode ambiguity, malformed UTF-8, invalid CRC, unsupported
compression and expansion beyond budgets are refused.

Only original private ZIP chunks are retained. Their server-derived descriptor
binds the run, upload, canonical chunk manifest, digests and expiry. The accepted
preview fingerprint is stable across JSONB key ordering. Commit verifies bytes
and the page/media manifest again. No client-supplied storage key selects an
unrelated object. Provider reads and writes remain outside service transactions.

Each file has a bounded private claim. Its digest, size, source fingerprint and
token are verified under the import-run lock before asset insertion. The asset
and import receipt commit in one transaction. Lost acknowledgements reuse the
accepted asset; stale workers cannot accept another asset. The real actor still
needs the public import operation and ordinary media/CMS grants. Private phases
add no scopes and fabricate no system actor. WordPress uses the same recovery.

An expired source can be rebound by uploading the identical original ZIP. Both
chunk identity and the full preview fingerprint must match; accepted media stays
owned by the run. Changed exports need a new run. Commit replay works after
raw-source cleanup. Accepted commit, rollback and ordinary replacement release
retention and schedule durable cleanup in the same transaction.

Unresolved PUT attempts retain individual witnesses, including rejected client
promises. Time, GET-not-found or a later identical successful write does not
settle an earlier unknown request. Shared cleanup, privacy receipts and explicit
holds apply to originals; see [import-source-storage.md](import-source-storage.md).
Internal claims, writes, hold IDs and reader/CRM bindings are omitted from
ordinary import responses.

## Qualification and remaining work

Independent Python `zipfile` fixtures exercise hostile structure and ordinary
content. Controls cover typed blocks, canonical manifests, range reads,
corruption, expiry/reupload, lost replies, concurrent/late workers, exact-key
actors, cleanup, replay and rollback. An ignored ZIP entry containing a synthetic
reader address proves that public previews cannot prove original-byte erasure.

Sources: `tests/core/archive-import.test.ts`, `archive-content.test.ts`,
`archive-import-flow.test.ts`, `import-media-receipts.test.ts`,
`redirect-default-locale.test.ts` and
`tests/browser/import-static-archive.spec.ts`. The browser uses actual owner
forms, keyboard operation, 320px bounds, both themes, four languages, literal
redirects, decoded public images and rollback. Exact run results accompany the
PR; test presence alone is not acceptance.

The 2026-11-11 privacy-integrated run passed 68 checks across seven files in
154 seconds, including original ZIP cleanup/erasure, WordPress media receipts,
unknown source writes and language-correct redirects. Eight SDK controls and
the complete fast gates passed (368 contracts, one deliberate skip). Eight
owner/public Chromium journeys passed before the final heading-wrap repair;
a valid longer unbroken hostname then reproduced overflow at 320px. All four
archive journeys passed again after repair, including actual text bounds,
RTL, both themes, decoded images, 301 redirects and rollback. The final
production scrub passed at 19,438 files / 238,159,373 bytes.
Earlier adjacent qualification passed 109 checks before the privacy rebase;
those overlapping checks are not a second current exact-tree run.

The pinned MIT runtime dependencies retain their upstream copyright/license
texts in `public/_freeholder/imports/NOTICE.txt`, distributed with public assets.

C3.22 remains unchecked. Durable cross-batch imports beyond these finite limits,
arbitrary hosted-builder exports, template/theme conversion and full generic
parity remain required. CSS and JavaScript are reported as omitted. Source-specific
live cutover, fragment target preservation and complete cross-target recovery
still require work and qualification. These are remaining specification
requirements, not optional deferrals or independent security sign-off.
