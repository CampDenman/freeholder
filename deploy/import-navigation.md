<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Importing and editing nested navigation

Canonical work is MASTER.md C3.22/C2.11. C3.22 remains open for complete
migration integration and source-specific acceptance.

A menu is one editable list on the existing CMS navigation block. **Menu level**
selects the top level or one of four nested levels. Put a parent before its
children. The same validated block is saved by the owner editor, HTTP and MCP;
there is no separate navigation store or SQL migration. Public output uses
nested lists in both desktop navigation and the native mobile Menu disclosure.
All platform choices and labels have English, Spanish, French and Arabic text.

WordPress imports reconstruct actual parentage before applying source order.
A matching owner parent keeps its own label and position; its source children
are merged below it. Repeated destinations under different parents remain
separate links. Category/tag targets use their imported archive paths, ordinary
query strings and fragments remain meaningful, and WordPress query-ID links
resolve to the imported page. Custom source addresses are validated before any
local-path or query-ID rewriting. Credentialed/invalid addresses stay unresolved
and cannot supply a fallback label; safe same-host links outside the imported
frontend base remain their original absolute URLs. Two pure controls reproduced
the raw-address bypass before repair; nine permanent controls include root and
index.php query links plus subdirectory ownership.

Missing parents and hierarchy cycles retain links as roots with a warning.
Links deeper than four nested levels remain in source order at the fourth
level, with an explicit warning. Unsupported archive targets remain unresolved.
These cases require review before claiming parity for that source.

Cutover consults the CMS's shared public resolver before advertising imported
page destinations. Draft or vetoed parents are omitted and surviving children
are promoted under their nearest visible ancestor. This is cutover validation;
ordinary navigation remains owner-managed content afterward. It does not claim
the continuously evaluated availability behavior of link-in-bio smart links.

The import records which nav block and entries it added. Rollback removes its
entries from that original block, preserving pre-existing owner parents,
owner-added descendants and a later duplicated nav block. Copied entries can
still point at an imported page that the owner also rolls back; review those
links after reversing the batch. Legacy import checkpoints retain their older
label/address rollback matching. Publish/rollback terminal transitions lock the
run, and successful retries leave the same stored result.

Local source qualification passed 59 integrated PostgreSQL/native checks for
menu planning, source discovery, exact import scopes, ownership, public privacy
and SDK consistency. After adding the translated owner warning report, the
final 63-check menu/WordPress/chrome/SDK qualification passed across three
sequential runs after the raw-URL repair and main integration; these counts
overlap the earlier run.
The additional three actual publish/rollback controls first failed because
Spanish, French and Arabic businesses received English menu changes. Cutover
now selects the business default language and records the actual CMS fallback
section language so rollback reverses the section it changed.

Eight actual Chromium journeys passed on separate fixture databases: English,
Spanish, French and Arabic RTL; owner menu-level editing and its real audit;
public parent/child structure; keyboard navigation; 320px control bounds;
both-theme Axe scans; translated private-target warnings; and existing public
source forms. The warning-only fixture seeds report metadata; the native tests
exercise actual private-target cutover. English light, Arabic dark and Arabic
owner-warning screenshots were visually inspected.

The final production build and artifact scrub passed (19,380 files,
228,952,691 bytes), along with type/lint/license/notes/plan and 368 contract
checks (one deliberate skip). Protected PR and merge-queue qualification are
still required. No live WordPress cutover, production rollout or stable
acceptance is claimed by this record.
