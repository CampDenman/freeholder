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
resolve to the imported page. Executable/credentialed links are not published.

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

Local source qualification currently includes 41 native/PostgreSQL controls:
source hierarchy/taxonomy/link intent, schema and semantic rendering, matching
owner parents, original-block ownership, private/vetoed labels, successful
replays and existing chrome behavior. Production-browser, build and protected
PR qualification are still in progress; no live cutover or stable acceptance
is claimed by this record.
