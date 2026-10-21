<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-16

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement or a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. This snapshot covers the `feat/rtl-ar-catalog` branch; refresh
GitHub before treating the pending change below as shipped.

## Implemented in the open RTL PR — not yet on main at this snapshot

- **Arabic ships as a complete catalog.** `locales/ar.json` carries all 6,340
  English strings in Modern Standard Arabic, ICU placeholders and plural
  contracts preserved exactly and enforced by `tests/core/i18n-gate.test.ts`.
  The provenance table in `locales/README.md` labels it AI-drafted pending
  native review, the same honesty the French and Spanish catalogs carry.
  Enabling `ar` in Settings flips the admin, storefront and portal to
  right-to-left from the locale's script — no layout rewrite.
- **Accessibility acceptance closes C11.12.** `tests/browser/accessibility.spec.ts`
  proves RTL from the shipped catalog instead of an injected `dir` attribute:
  `/admin`, `/ar` and the portal all render `html[lang=ar][dir=rtl]` and pass
  axe WCAG 2.0/2.1/2.2 A+AA — the admin in both asserted themes — plus the
  bypass-link, Enter-to-main and 12-stop keyboard loop, and the 320px reflow
  with nested-scroll refusal. Populated contact, invoice, product and
  appointment detail forms carry the same full pass, ten owner screens join
  the list scan, and the French and Spanish storefronts join the 320px
  reflow. The covered matrix is locale (en/fr/es/ar) × theme (light/dark) ×
  viewport (1280px/320px) across admin, detail forms, storefront and portal.
- **Arabic SMS compliance.** The mandatory carrier control words recognise
  Arabic STOP/START/HELP keywords and the non-configurable compliance replies
  answer in Arabic for an Arabic-preferred contact; owner keyword rules still
  cannot shadow any of them.

Native review of the Arabic catalog remains the follow-up, as it does for
French and Spanish. Live provider acceptance and the other open C-items are
unchanged.

## F-criteria evidence matrix — closes C0.11 and C11.09 (docs(plan) PR)

- **Every completion claim now faces all twelve F-criteria.**
  `deploy/f-criteria-matrix.md` audits F01–F12 across 286 rows: every live
  §43 checklist item (the row set computed from `scripts/plan-gate.mjs`, so
  it cannot drift from the plan), the seven mobile items deferred to v2,
  all seven workspace packages and all six first-party plugins. Every cell
  is a repository citation that resolves or a specific `N/A — reason`.
- **The matrix is gate-enforced, not a one-time document.**
  `scripts/f-matrix.mjs` + `tests/core/f-matrix.test.ts` fail on row-set
  drift, empty cells, unresolvable citations, cited test files outside the
  suite, and lazy N/A — and run inside `pnpm gates`.
- **The C0.11 audit sampled for truth, not presence.** Every item the
  2026-09-13 audit reopened or repaired was re-read assertion-by-assertion
  (all confirmed true), plus a deterministic 15% sample of the rest. Three
  finding classes are corrected in the change: C4.08's annotation claimed
  the calendar screen as its F04 (now `/admin/work/playbooks`); 45
  annotations carried a "covers permission, refusal and recovery" stamp
  their cited file does not prove (narrowed per-cell in the matrix with
  `tests/core/api.test.ts` named for the scoped-permission half; annotation
  rewrites landed with C11.15 below); C11.12/C1.17 cells cited catalog gates as
  service-boundary proof (curated to the true evidence). No capability
  claim proved false; no unrelated checkbox moved.
- **Full-suite verification** is recorded in the matrix header — the whole
  `pnpm test` suite ran green on a fresh disposable database with every
  cited test file part of the run.

## Doc-claim mapping — C11.15 closed (docs/doc-claim-mapping)

- **Every §§1–42 claim now carries evidence or a same-change strike.**
  `deploy/doc-claim-mapping.md` inventories 118 claim rows across all 42
  sections: 108 map to a passing suite, gate or generated artifact, and 10
  are Struck/Narrowed in MASTER.md itself — §12's mail-adapter id literal,
  §21b's `scripts/backup.sh` path (the script ships at
  `deploy/digitalocean-droplet/infra/backup.sh`), §25's "MIT plugin-kit"
  (every package is Apache-2.0), §27's hosted canonical-registry/catalog
  claims, §28's hosted docs site with executable guides, §31's "pgvector"
  (retrieval ranks a `real[]` column by cosine on stock Postgres), §4.8's
  instance-release-notes scope (platform upgrades auto-draft today; wider
  auto-draft and the agent-note mandate remain work), §37's "every accepted
  change writes a ReleaseNote", §38's unqualified release-notes bullet, and
  §34's changelog share target. The item text's two judgement calls stand as
  documented behaviour: §35 branded placeholder screenshots and adapter
  "not implemented" fail-closed refusals.
- **The map is a gate, not a promise.** `tests/core/doc-claim-mapping.test.ts`
  (in `pnpm gates` via `scripts/fast-gates.mjs`) fails on any unmapped
  section, any evidence path that does not resolve, any claim row citing no
  test or gate, and any strike whose old wording still parses in MASTER.md
  or whose new wording is missing. C11.15 is checked with F04/F05 N/A,
  F07 = the fail-closed mapping gate, F09 = the mapping doc + gate, F12 =
  alignment with `deploy/spec-reconciliation.md`.

## Session wrap — completion push

- **Everything closable by software is closed.** Since the 2026-09-15
  snapshot, #381–#397 landed: note/task trash, real queue-dispatch
  measurement, the dependabot react-group fix, the §43.18 mobile→v2
  deferral, the Arabic RTL catalog (C11.12), C3.13's software remainder,
  trash for pages/forms/popups/segments/saved views (C11.14), the F01–F12
  evidence matrix (C0.11, C11.09) and the §§1–42 claim mapping (C11.15).
  Dependabot #373–#380 and #83 merged; #109 (TypeScript major) closed as a
  deliberate manual upgrade.
- **Plan state: 290 IDs, 272 checked, 18 open.** The 18 are §43.2's twelve
  F-template rows plus six C-items, each blocked on the owner: C3.13 (live
  Printify/Shopify/Daily accounts), C11.08 (Replit/DO second target), C11.10
  (named reviewer), C11.11 (doctl auth + droplet), C11.16 (auto-unblocks
  after C3.13), C11.17 (owner signature). No closable-by-software work
  remains; mobile devices are v2 scope, so no v1 wipe or setup is pending.
- **Handoff and evidence refreshed.** `SESSION_HANDOFF.md` now carries the
  owner action list with prepared commands; §43.1's evidence snapshot cites
  this digest, the matrix and the claim mapping. Full-suite verification:
  3,655–3,657 tests passing, 17 deploy-recipe skips, one pre-existing funnel
  isolation flake (documented in both mapping headers).
