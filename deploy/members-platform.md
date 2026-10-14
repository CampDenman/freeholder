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

## C12.04 — posts and feeds (2026-10-14)

- Services: `src/modules/members/posts.ts`. The home feed query restates
  `canSee` in SQL so a page is one query; `tests/modules/member-posts.test.ts`
  holds both to the same answers.
- Screens: `/feed` (Following and Latest), `/p/[id]`, `/tags/[tag]`, posts on
  `/@handle`, tag approvals at the top of `/feed`.
- Tests: `tests/modules/member-posts.test.ts` (4 cases) and the third journey
  in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.
- Not yet: media attachments (C12.21); notifications for mentions, comments
  and reactions (C12.13; events are already queued).

## C12.13 — member notifications (2026-10-14)

- `src/modules/members/notify.ts` decides whether one member hears about
  another; core notifications deliver. Member topics: `members.follow`,
  `members.friend`, `members.mention`, `members.comment`, `members.reaction`.
- Screen: `/portal/notifications` (recent items, mark all read, per-topic
  in-app and email settings).
- Tests: `tests/modules/member-notifications.test.ts` (2 cases) and the
  notifications steps in `tests/browser/members.spec.ts`. Passed locally.
- Not yet: web push and quiet hours (C12.22).

## C12.06 — direct messages (2026-10-14)

- Services: `src/modules/members/messages.ts`. Bodies are sealed at rest by
  `src/modules/members/message-crypto.ts` (AES-256-GCM, bound to the message
  id, keyed from `CREDENTIAL_KEY` or `SESSION_SECRET`). This is not end-to-end
  encryption; `/messages` says so. MLS end-to-end encryption is C12.23.
- Screens: `/messages` (inbox, requests, new conversation), `/messages/[id]`,
  Message link on `/@handle`, read-receipt setting on `/portal/member`.
- Tests: `tests/modules/member-messages.test.ts` (4 cases) and the fourth
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.07 — one-to-one calls (2026-10-14)

- Services: `src/modules/members/calls.ts`; browser side
  `app/(public)/call/CallRoom.tsx` (WebRTC) and `IncomingCall.tsx`.
- Relay: set `TURN_URLS` (comma-separated `turn:`/`turns:` URLs) and
  `TURN_SECRET` (coturn `static-auth-secret` with `use-auth-secret`) to give
  calls one-hour relay credentials. `STUN_URLS` is optional. With none of
  these, calls connect only when a direct path exists. freeholder.ai does not
  run a relay yet.
- Tests: `tests/modules/member-calls.test.ts` (4 cases),
  `tests/browser/member-calls.spec.ts` (real WebRTC between two contexts).
- Found while building: `app/(public)/layout.tsx` resolves `publicActor` from
  the analytics cookie (`fh_s`), not the sign-in session, so the owner's
  on-page builder link likely never shows. Not changed here; the call bar
  reads the sign-in session directly.
- Not yet: group calls (C12.24).
