<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# `@freeholder/mobile-app`

The white-label customer app for a [Freeholder](https://github.com/CampDenman/freeholder)
instance. *MASTER.md §35, §35.1 — checklist item C10.12.*

## What this package is

§35.1's first rule decides the shape of everything here:

> The app is a client, never a second implementation. Every screen calls the
> generated SDK against the instance's own API. There is no mobile-only
> endpoint, no mobile-only business rule, and no mobile-only notion of a
> customer.

This package contains the shared client behavior:

| Module | Answers |
|---|---|
| `discovery` | which instance am I talking to, and can this binary talk to it? |
| `session` | how is a session held on a device? |
| `offline` | what do I show with no signal? |
| `private-cache` | how does encrypted persistence remain bound to a live session? |
| `cached-discovery` | can a remembered instance reopen offline without bypassing compatibility? |
| `branding` | what does this business look like? |
| `screens` | which services may each customer or staff screen call? |
| `capture` | how does owner ingest reach the core media contract? |
| `capture-batches` | the one offline write: a file queue with consent, progress, pause/resume/cancel/retry |
| `strings` | how do the screen's catalog keys read in this locale? |

Everything else — prices, availability, entitlements — comes from the instance
over HTTP. A test asserts this package imports nothing but its own files and
node builtins, so it cannot quietly grow a rule that goes stale during store
review.

## Instance discovery

The app asks for the business's address and fetches `/.well-known/freeholder`.
People type `example.com`, `www.example.com/` and `https://example.com/portal`,
and all three mean the same business, so the address is normalized rather than
rejected — then https is required, because everything after this carries a
session token and a phone is usually on somebody else's wifi.

Four "no" answers, deliberately different sentences:

- **not a Freeholder site** — a typo the customer can fix.
- **setup is not finished** — the owner's problem; wait, don't retype.
- **could not be reached** — connection or spelling.
- **this app is too old** — nobody's fault, one fix. Carries the store links
  rather than a retry button.

An instance *older* than the app is fine. The platform only ever adds, and an
owner who has not updated should not be locked out of their own app.

## Auth

Magic link and password, the portal's own. The token goes in the platform
keychain via the injected `SecretStore` — never `AsyncStorage`, which is a JSON
file in the app sandbox that lands in unencrypted device backups.

`signIn` calls the token-returning `auth.login` API projection for passwords
and `auth.requestCustomerMagicLink` for email links. `redeemSignInLink` accepts
the original email URL only from the connected instance and passes its token
to `auth.consumeCustomerMagicLink`. `completeTwoFactorSignIn` finishes an
enrolled TOTP/recovery challenge through `auth.completeTwoFactorLogin`. A
failed request, used link, or unfinished two-factor challenge never becomes a
stored session. These calls omit ambient cookies. The Expo account tab revokes
a stored device token through `notifications.revokeDevice` before clearing the
session.

**Biometric unlock guards re-opening the app, never the login.** A fingerprint
is a convenience over a session the server already granted, not a factor the
server knows about. A broken sensor shows the app rather than locking a
customer out of their own bookings; a failed check locks the screen but does
not sign anyone out.

## Offline

Read-through, write-never. `readThrough` throws `OfflineWriteRefused` on a
mutation — a booking made offline is a booking against availability that may no
longer exist, and a payment queued offline is a payment somebody believes they
made.

Cached content always renders with **when** it was fetched, not just *that* it
is stale. When nothing usable is cached, the app says so rather than showing
an empty gallery. Private native snapshots use `PRIVATE_CACHE_LEASE_MS` (60
seconds) through `readThrough({ maxAgeMs, ... }, call, cache)`. Network and
persistence latency count against the lease; failed reads never renew it.
HTTP 401/403/404 evict instead of falling back. The returned `expiresAt` lets
the native binding clear displayed data and revalidate on expiry/foreground.
Private gallery image bytes use the same lease, keyed as `galleries.viewItem`
by slug and item, so a revoked gallery cannot stay readable on the phone past
that minute. Proofing mutations go through `writeThrough` and are never queued.

`encryptedCache` wraps platform storage with authenticated encryption and binds
each payload to its requested cache key. `revocableCache` serializes operations
and invalidates old callers synchronously; `privateCacheScope` orders account
changes, including an asynchronous keychain open finishing after sign-out.
The Expo adapter supplies AES-GCM and a key held in SecureStore; this package
adds no crypto or native dependency. Public cached discovery restores branding
only for the remembered instance and cannot extend any private read lease.

Companion mode (C10.17) is the same client with a staff session. `sessionAudience`
reads the named role from `auth.whoami` / `auth.login`; `customer` keeps the
portal tabs and every other role opens `OWNER_TAB_ORDER`. Capture ingest talks
to the existing media services and `/api/media`. The one sanctioned write queue
is media capture (C10.18): `createCaptureBatchStore` records consent, destination,
progress, pause/resume/cancel/retry, and flushes through the same live contract
once online. The queue is bound to one instance and session, persists file
bytes, and is dropped on sign-out. `writeThrough` still refuses every other
mutation.

`writeThrough({ service, online }, call)` is the live-only counterpart:
offline calls throw `OfflineWriteRefused` before transport is invoked. Online
calls run once and propagate failures, with no cache, retry or queue. The Expo
`useScreenWrite` binding checks the screen's write contract before using it.

## Screen copy (C10.24)

`appText(locale, key)` resolves the literal `app.*` screen labels from the
shared catalogs, including regional locales such as `fr-CA`. Unsupported
locales fall back to English; unknown keys show a localized unavailable
message. Regenerate the bundled subset with
`node scripts/generate-mobile-messages.mjs` after editing root catalogs.

## Licence

Apache-2.0, like the rest of the project. (§35 originally said MIT; that
contradicted C0.10, `LICENSING.md` and the licence gate, and was corrected
in the same change that created this package.)
