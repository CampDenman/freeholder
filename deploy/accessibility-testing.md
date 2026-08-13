# Real-browser accessibility testing

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder's accessibility acceptance gate runs the production build in
Chromium. The older jsdom helper is still useful for fast structural unit
checks, but it cannot make an acceptance decision about layout, focus, media
preferences or a browser accessibility tree.

## What CI proves

`tests/browser/accessibility.spec.ts` covers an unconfigured setup screen and
seeded admin, page editor, storefront and customer privacy portal. For every
surface it:

- runs axe's WCAG 2.0, 2.1 and 2.2 A/AA rules in explicit light and dark
  themes, including browser-computed colour contrast;
- uses real Tab and Enter key input, requires the translated skip link to be
  the first stop, and checks that focused controls have a visible 2 px outline
  and are both in view and unobscured;
- renders at 320 CSS pixels and rejects document overflow or nested horizontal
  scrolling in the page and same-origin editor preview;
- inspects Chromium's ARIA snapshot and named roles for the heading,
  landmarks, navigation, form controls and editor preview that identify each
  surface; and
- emulates `prefers-reduced-motion: reduce`, then rejects lingering animation,
  transition, repeated animation or smooth scrolling. The editor also proves
  that it had a real transition before reduction, so this cannot pass by
  checking an interface that never moved.

Failures retain a screenshot, video and trace under `test-results/browser`.
Playwright's HTML report is retained under `playwright-report/browser` in CI.
Neither directory is committed.

## Run it locally

Set `TEST_DATABASE_URL` (or the more specific `A11Y_DATABASE_URL` or shared
`BROWSER_DATABASE_URL`) to a
throwaway PostgreSQL database whose name contains `test` or `a11y`. The suite
refuses every other database name before it connects or truncates anything.
It migrates and resets that database, creates only deterministic fixtures,
and restores the empty, role-seeded state when it finishes so later CI gates
cannot inherit browser-test data. It uses a factor-enrolled, factor-verified
owner session inside the test database; there is no application or production
authentication bypass.

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:a11y
```

The app starts on `http://localhost:3100`. Override that with
`A11Y_BASE_URL` (or shared `BROWSER_BASE_URL`) only when the replacement URL
reaches the same local test process and database. `pnpm test:browser` runs this
suite and the product journeys described in
[`browser-journeys.md`](browser-journeys.md) serially against that database.

## Human verification still matters

Automated axe checks and ARIA snapshots expose many semantic and naming
failures; they do not tell us whether an announcement is concise, a workflow
is understandable, or a particular screen reader and browser pairing is
pleasant to use. Before a release that materially changes one of these
surfaces, walk its primary task with keyboard alone and with at least one
desktop screen reader (NVDA or VoiceOver). Use TalkBack or VoiceOver on a
phone when the change affects the narrow layout. Record product defects in
`MASTER.md`'s applicable completion item rather than weakening the browser
gate or creating a parallel accessibility backlog.
