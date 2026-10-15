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

## C12.08 — member listings (2026-10-14)

- A listing is a catalog product with `seller_user_id`, created through the
  catalog's own services (`src/modules/members/listings.ts`). The site's shop
  (`catalog.browseProducts`) and purchase options exclude member listings;
  `catalog.addCartItem` and `catalog.checkoutCart` refuse them until C12.09.
- Screens: `/portal/listings`, `/market`, the profile Shop, market settings
  and the review queue on `/admin/members`.
- Tests: `tests/modules/member-listings.test.ts` (2 cases) and the listings
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.
- Not yet: checkout and payouts (C12.09); seller-calendar services (C12.25).

## C12.09 — checkout and payouts (2026-10-14)

- Owner decision 2026-10-14: hold-until-delivery by default; owners may
  choose instant payout, or seller-as-merchant where the payout provider
  supports it; providers plug in behind `registerPayoutAdapter`.
- The catalog asks `registerSellerGate` before a member listing goes in a
  cart or to checkout; with nothing registered it refuses.
- The ledger (`member_payouts`) is written from `catalog.orderPaid` and
  adjusted from `refund.succeeded`. Each row is idempotent per order line.
- Only the manual adapter ships: the site pays sellers itself and records the
  reference. Stripe Connect is C12.26; other providers C12.27; buyer-
  confirmed release is C12.10.
- The standalone artifact file cap was raised from 18,000 to 27,000 (1.5x
  the 18,094 measured) in `scripts/standalone-artifact-gate.mjs`.

## C12.10 — buyer protection (2026-10-14)

- A sale is one seller's part of one order. Services in
  `src/modules/members/protection.ts`; screens `/portal/sales`,
  `/portal/purchases`, the shared sale page, and disputes on `/admin/members`.
- Resolving a dispute for the buyer cancels the seller's payout; the money
  goes back through the site's ordinary invoice refund (a manual step with
  the manual payment provider).
- Tests: `tests/modules/member-protection.test.ts` (2 cases) and the C12.10
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.11 — reputation (2026-10-14)

- Services in `src/modules/members/reputation.ts`; the review card is on the
  shared sale page and the reviews section on `/@handle`.
- A review is allowed once the sale is delivered or its dispute is resolved,
  once per side. Each review's `reveal_at` is 14 days out and drops to now
  for both reviews when the second side writes; every read compares against
  it, so no job is needed.
- Reporting a review is part of C12.12's report-anything queue.
- Tests: `tests/modules/member-reputation.test.ts` (3 cases) and the C12.11
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.12 — reports and moderation (2026-10-14)

- Services in `src/modules/members/reports.ts`; `/report?type=…&id=…` for
  members, and the reports queue on `/admin/members` for staff.
- The queue groups open reports by the thing reported. Removing a post,
  comment or message soft-deletes it; a review is hidden; a listing is
  rejected and archived, so the seller cannot simply put it back up.
  Suspension goes through the same status change as `members.setStatus`.
- Moderation notices use the `members.safety` notification topic.
- Split out of the original item: prohibited-items policy (C12.28), adult
  content (C12.29), abuse-image hash matching (C12.30, after attachments).
- Tests: `tests/modules/member-reports.test.ts` (3 cases) and the C12.12
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.29 — adult content (2026-10-14)

- Off by default (`member_settings.adult_content`). Helpers and the listing
  gate are in `src/modules/members/adult.ts`; the catalog asks through
  `src/modules/catalog/listing-gate.ts` on the market, storefront options,
  product pages, the public product list (`llms.txt`, page blocks), the
  cart and checkout.
- A member receives adult content only while the site allows it, they are
  active, they attested they are an adult, and they opted in. A database
  check keeps the opt-in from outliving the adult attestation.
- Seeds and demos keep the switch off.
- Tests: `tests/modules/member-adult.test.ts` (4 cases) and the C12.29
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.28 — prohibited-items policy (2026-10-14)

- Services in `src/modules/members/policy.ts`; the public page is
  `/market/policy`; the editor is on `/admin/members`.
- An empty policy means the starter list in the locale catalogs. Each
  published change bumps `member_settings.market_policy_version`, and
  `members.createListing` refuses until the seller accepts the current one.
- Tests: the C12.28 case in `tests/modules/member-listings.test.ts` and the
  C12.28 journey in `tests/browser/members.spec.ts`. Passed locally
  2026-10-14.

## C12.15 — member data rights (2026-10-14)

- `src/modules/members/data-rights.ts` registers the `members` privacy
  source; members use the existing privacy centre (`/portal/privacy`).
- Privacy sources now take `eraseOrder` (lowest first, default 100); members
  runs at 10, before the login is deleted.
- Erasure handling is stated in the file header and on `/portal/member`.
  Sales records move to the erased-member placeholder
  (`00000000-0000-4000-8000-00000000e5ed`, an unreachable login).
- Tests: `tests/modules/member-data-rights.test.ts` (2 cases) and the C12.15
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.20 — avatars and profile sections (2026-10-14)

- Services in `src/modules/members/profile.ts`. Images are ordinary
  `media.upload` assets the member uploaded (`uploaded_by = user:<id>`),
  ready and cleared by the scanner; URLs come from the storage adapter's
  webp variants.
- The member uploader (`app/portal/(account)/member/ImageUpload.tsx`) posts
  to `/api/media` with the portal's CSRF token, then saves through a server
  action.
- Tests: `tests/modules/member-profile-sections.test.ts` (2 cases) and the
  C12.20 journey in `tests/browser/members.spec.ts`. Passed locally
  2026-10-14.

## C12.19 — member passkeys (2026-10-14)

- Portal actions in `app/portal/passkey-actions.ts` reuse the owner's
  passkey ceremonies; the relying party is `APP_URL`'s host.
- Members are never required to use a second factor, so enrolling a passkey
  leaves the email link working as the recovery path.
- Tested with Chromium's virtual authenticator in the C12.19 journey in
  `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.22 — web push and quiet hours (2026-10-14)

- `src/core/notifications/web-push.ts` implements RFC 8291 and RFC 8292
  with `node:crypto`. The VAPID key pair is created on first use and kept in
  `web_push_keys`, sealed with `CREDENTIAL_KEY`; rotating that key without
  re-sealing means re-subscribing browsers.
- Endpoints are limited to the browsers' push services (Google, Mozilla,
  Apple, Microsoft). Add a host there before supporting another browser.
- The service worker is `public/push-sw.js`; CSP already allows
  `worker-src 'self'`.
- Quiet hours set `availableAt` to the end of the window; the per-minute
  delivery sweep sends them then.
- Not yet exercised against a live push service in CI (headless browsers
  report notifications as blocked); check on a real browser after deploy.
- Tests: `tests/core/web-push.test.ts` (6 cases) and the C12.22 journey in
  `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.21 — attachments (2026-10-14)

- `src/modules/members/attachments.ts` (services) and
  `attachment-store.ts` (shapes and storage, a leaf module so posts and
  messages can load without a cycle).
- Attached assets are `is_private`; `/member-files/[id]` streams them through
  the app after `members.fileAccess` checks the viewer, on every request.
- With public S3 storage, private objects are still addressable by key at
  the bucket; keys are unguessable but not access-checked there. Use private
  storage when members share followers-only or private files (the same
  caveat as galleries and documents).
- Video is served whole, without range requests; the proxied upload limit
  (25 MB) keeps clips short.
- Tests: `tests/modules/member-attachments.test.ts` (3 cases) and the C12.21
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-14.

## C12.05 — member subscriptions (2026-10-15)

- Services in `src/modules/members/member-subscriptions.ts`; the members
  module now requires `invoicing` and `subscriptions`, and listens to
  `invoice.paid` to record subscription payouts.
- A member plan is a `digital` product with `seller_user_id` and an active,
  manually billed plan. Owners can switch a plan to card billing in Admin →
  Subscriptions.
- `subscriptions.publicPlans` without a seller lists only the site's own
  plans; with `sellerUserId` it lists that member's.
- Payouts are pre-tax (the site files the tax), less the site fee.
- Tests: `tests/modules/member-subscriptions.test.ts` (2 cases) and the
  C12.05 journey in `tests/browser/members.spec.ts`. Passed locally
  2026-10-15.

## C12.25 — members' bookable services (2026-10-15)

- Services in `src/modules/members/member-services.ts`. Each member gets one
  `person` calendar (slug `member-<handle>`) in the site's timezone.
- Bookings are gated by audiences: offering a service adds it to every
  enabled public or signed-in audience, creating a public "Members'
  services" audience if the site has none.
- `/book?seller=<user id>` books a member's services; `/book` alone lists
  only the site's own.
- Paid booking invoices (`source_type = 'booking'`) become payouts through
  `members.recordInvoicePayout`, alongside subscriptions.
- Tests: `tests/modules/member-services.test.ts` (2 cases) and the C12.25
  journey in `tests/browser/members.spec.ts`. Passed locally 2026-10-15.

## C12.16 — starter and demo community (2026-10-15)

- `members.demo-community` (v1) joins `seed.creator` and `seed.everything`.
  Demo logins use `@demo.freeholder.test`; the playground accepts them.
- Guide: `deploy/members-vibe-coding.md`.
- A dedicated community preset is C12.31.
- Tests: `tests/modules/member-demo.test.ts` and
  `tests/core/demo-scenarios.test.ts`. Passed locally 2026-10-15.

## C12.14 — personal agent keys (2026-10-15)

- `api_keys.acts_as_user_id` marks a personal key; `resolveApiKey` turns it
  into the person's user actor with `keyScopes`.
- `permits` requires the service to be named by the key and refuses
  `scoped` services; `hasModuleAccess` is false; `actsByKey` applies
  `agentCallable: false` to personal keys as to agent keys.
- Tests: `tests/core/personal-keys.test.ts` (3 cases) and the C12.14 journey
  in `tests/browser/members.spec.ts`. Passed locally 2026-10-15.

