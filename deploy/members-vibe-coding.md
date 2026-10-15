<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Building a member site with an AI builder

Freeholder is one site with many members (MASTER.md §44): people join,
publish, follow, message, call, buy and sell with each other. This guide is
for building on that with Replit, Lovable or a coding agent. Launching an
instance is covered in `deploy/agent-launch.md`; this picks up after launch.

## See it working first

1. In **Admin → Demo scenarios**, load **Everything** or **Creator**. Both
   include the demo community: three `[Demo]` members (`@demo_ada`,
   `@demo_ben`, `@demo_cy`) who follow each other, post, talk and sell a
   listing. Purging the scenario removes them completely.
2. Open `/feed?view=latest`, `/@demo_ada` and `/market`.
3. In **Admin → Members**, choose how people join, the minimum age, whether
   members may sell, the payout model and provider, adult content, and the
   prohibited-items policy. Everything is off or conservative by default.

## What exists, by area

Every capability is a service, so it is the same over the UI, HTTP
(`/api/openapi.json`), the SDK and MCP:

- **Joining and profiles:** `members.join`, `members.updateMe`,
  `members.profile`, `members.setAvatar`, `members.saveProfileSection`,
  `members.pinPost`.
- **Graph:** `members.follow`, `members.befriend`, `members.setRelation`
  (block, mute, restrict), `members.connections`.
- **Posts:** `members.post`, `members.feed`, `members.latest`,
  `members.postsBy`, `members.viewPost`, `members.comment`, `members.react`;
  photos and video through `media.upload` then `attachments` on the post.
- **Messages and calls:** `members.startConversation`, `members.sendMessage`,
  `members.startCall` (WebRTC, peer to peer; set `TURN_URLS`/`TURN_SECRET`
  for people behind strict networks).
- **Market:** `members.createListing`, `catalog.marketListings`, checkout
  through the ordinary cart, `members.mySales`, `members.myPurchases`,
  disputes, `members.leaveReview`, and `members.payouts`.
- **Subscriptions and bookings:** `members.createSubscriptionPlan`,
  `members.subscriptionPlans`, `members.offerBookableService`,
  `members.bookableServices` (booking itself is `/book?seller=…`).
- **Safety:** `members.report`, `members.reports`, `members.resolveReport`,
  `members.marketPolicy`.

## Replit

After launching (`deploy/agent-launch.md`) and connecting MCP at
`/admin/connect` with **Edit and publish pages**, ask Replit Agent:

> Use my Freeholder MCP connector. This site is a community of members.
> Read deploy/members-vibe-coding.md. Build the home page around the member
> feed and market using Freeholder's CMS blocks and pages, link /join,
> /feed, /market and member profiles, and publish. Do not add a separate
> user system or database: members, posts, messages and listings already
> live in Freeholder. Verify the public pages after publishing.

## Lovable

Lovable builds a new interface against a Freeholder you host (it cannot
import this repository). Connect MCP as in `deploy/agent-launch.md`, then:

> Use my Freeholder MCP connector and read the member services it offers.
> Build a community front end: a public feed (members.latest), member
> profiles (members.profile, members.postsBy), and the market
> (catalog.marketListings). Send people to Freeholder's own /join, /portal
> and /messages pages for anything they do as themselves.

Public pages can read through a **server-side** integration with a read-only
key. Anything a member does as themselves (posting, messaging, buying)
happens in their own signed-in Freeholder session. Never give a front end an
admin key to act for members. Member-issued, scoped keys for a member's own
agent are planned (C12.14) and do not exist yet.

## Coding agents (Claude Code, Codex and others)

Work in this repository the way `AGENTS.md` and `CLAUDE.md` describe. For
member features:

- The members module is `src/modules/members`; read MASTER.md §44 first and
  name the C12 item in your change.
- Add capability as a `defineService` in the module, never as a route-only
  handler, so HTTP, SDK and MCP get it too. Use `ctx.call` to compose and
  check visibility with `relationBetween` / `canSee` from `graph.ts`.
- Anything a member can see is checked on every read; never widen an
  audience (see attachments, pinned posts and adult content for patterns).
- Tests: a module test in `tests/modules/member-*.test.ts` and a journey in
  `tests/browser/members.spec.ts`; strings in all four locale catalogs.
- Before pushing: `pnpm gates`, `pnpm plan:check`, `node scripts/f-matrix.mjs`,
  and `pnpm sdk:generate` with a test database.
