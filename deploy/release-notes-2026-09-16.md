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
