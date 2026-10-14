<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Members platform — acceptance record

Owner decision 2026-10-14: a Freeholder site serves many members who publish,
connect, message, call, buy and sell with each other. `MASTER.md` §44 is the
specification and §43.19 (C12.01–C12.18) is the checklist.

Nothing in C12 is implemented yet. Record evidence here as each item lands:
tests, live verification, and anything still unproven. Do not check a C12 item
from mocked payment, mail or media runs alone.

## C12.01 — member accounts (2026-10-14)

- Services: `src/modules/members/service.ts` (`members.join`, `members.me`,
  `members.updateMe`, `members.settings`, `members.updateSettings`,
  `members.handleAvailable`, `members.list`, `members.setStatus`,
  `members.invite`).
- Screens: `/join`, `/portal/member`, `/admin/members`.
- Tests: `tests/modules/members.test.ts` (5 database cases),
  `tests/browser/members.spec.ts` (real-browser journey with axe in both
  themes). Both passed locally against PostgreSQL 16 on 2026-10-14.
- Not yet: passkey sign-in for members (C12.19); demo members (C12.16).

## C12.02–C12.03 — profiles and the social graph (2026-10-14)

- Services: `src/modules/members/graph.ts` (`members.profile`,
  `members.follow`, `members.unfollow`, `members.answerFollow`,
  `members.befriend`, `members.unfriend`, `members.setRelation`,
  `members.connections`); visibility and privacy settings on `members.updateMe`.
- Every read of one member by another goes through `relationBetween` and
  `canSee`. Later items (posts, messages, calls) must reuse them.
- Screens: `/@handle` (rewritten to `/m/[handle]`), `/portal/connections`,
  privacy settings on `/portal/member`.
- Tests: `tests/modules/member-graph.test.ts` (5 cases),
  `tests/browser/members.spec.ts` (2 journeys). Passed locally 2026-10-14.
- Not yet: avatars and profile sections (C12.20); subscriber visibility
  resolves with C12.05.
