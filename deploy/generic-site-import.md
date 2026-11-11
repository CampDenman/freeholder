<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Generic source content qualification — C3.22

Generic HTML, RSS and Atom now stage editable typed content through the existing
import services. They retain actual titles, metadata, source paths, dates and
media identities without introducing WordPress author, taxonomy or query-ID
semantics. A pasted sitemap is discovery input: commit refuses an empty content
draft and asks for rendered source content through the bounded public crawler.

The existing public transport enforces pinned public addresses, same-origin
page traversal, robots, rate and byte/depth limits. Missing local media is
downloaded outside transactions after a fresh robots check. Acceptance uses the
same atomic import/media receipt as WordPress and ZIP imports, preserving exact
actor, import, media-upload and media-read permissions. Query-bearing media
URLs remain distinct identities. Filename extensions for endpoint images come
from verified signatures; ordinary media validation still refuses unsupported
SVG and misleading bytes. Off-origin or blocked media remain visible warnings.

Native link-target blocks preserve actual HTML `id` and legacy named anchors.
The public browser proof follows a source fragment, checks the one real target
and verifies that the viewport actually scrolls to it. ZIP content plan version
two preserves outer content IDs and reports unsupported SVG as omitted;
version-one retained previews restore with their original exact fingerprint.

The owner sees source and media warnings before commit, with proposed/staged
counts distinguished from completed writes. URLs retain left-to-right order
inside the Arabic interface. Owner/public browser journeys use 320px viewports,
keyboard submission, both themes, Axe, actual redirects, public DOM targets,
metadata and rollback in English, Spanish, French and Arabic.

## Recorded local evidence

- `generic-plan`, `generic-feed`, `archive-content`, `archive-import` and
  `import-media-filenames`: 71 pure controls passed.
- `generic-import-flow`, `import-crawl-flow`, `archive-import-flow`,
  `wordpress-import-flow` and `import-media-receipts`: all 38 unique controls
  passed across the final run and a 14-control affected rerun. Three failures
  in the first run were corrected fixtures: root source URLs require owner
  conflict review, and an existing published page retains its working copy.
  The future-entry refusal now compares the complete unchanged page row.
- SDK generation ran the real registry, with eight passing controls.
- Final label/RTL production build and artifact scrub passed: 19,441 files,
  237,963,155 bytes.
- All four final owner/public Chromium journeys passed after that build,
  including the staged/completed report labels. English/light and Arabic/dark
  mobile screenshots were also visually inspected.
- Complete local fast gates passed: type/lint, license, release notes,
  specification, playground policy and 368 contracts with one deliberate skip.
  The inherited 32-shard capacity gate then passed all five full-partition/
  degraded-budget controls; workflow integrity also passed. The unchanged
  timeout, slow-runner multiplier and complete-file coverage remain enforced.
- Protected CI then exposed two older root-URL fixtures expecting distinct
  page paths. The fixtures now request their intended `/team` and
  `/exact-commit` sources; all six controls in both affected suites pass,
  retaining empty-home handling and independent CMS permission checks.
- After protected main merged raw privacy as `952bc31f`, the generic stack
  rebased onto archive/main integration. Import, media and owner import UI
  runtime source remains byte-identical to qualified head `c774aaf7`;
  additive locale keys retain both parent and importer wording. Twelve actual
  content/scope/install-rollback controls, eight SDK controls and the complete
  373-contract fast gates (one deliberate skip) pass on this composition.

Synthetic HTTP/storage fixtures prove application behavior; they do not prove
acceptance in an actual external provider account. Protected CI and the final
independent review remain required. C3.22 stays open for durable cross-batch
imports above the finite 500-item/20 MB body limits, complete page-query intent,
common hosted-source/CDN paths and actual source-specific cutover acceptance.
