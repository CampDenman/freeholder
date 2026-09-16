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
  rewrites queued on C11.15); C11.12/C1.17 cells cited catalog gates as
  service-boundary proof (curated to the true evidence). No capability
  claim proved false; no unrelated checkbox moved.
- **Full-suite verification** is recorded in the matrix header — the whole
  `pnpm test` suite ran green on a fresh disposable database with every
  cited test file part of the run.
