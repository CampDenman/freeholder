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

So this package contains exactly the four things a client needs that the
platform cannot supply:

| Module | Answers |
|---|---|
| `discovery` | which instance am I talking to, and can this binary talk to it? |
| `session` | how is a session held on a device? |
| `offline` | what do I show with no signal? |
| `branding` | what does this business look like? |

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
is stale: a gallery from four minutes ago is worth proofing and one from last
Tuesday is not. When nothing has been cached, the app says so rather than
showing an empty gallery.

The one sanctioned write queue is media capture (C10.18), which is a queue of
files rather than a queue of decisions.

## Licence

Apache-2.0, like the rest of the project. (§35 originally said MIT; that
contradicted C0.10, `LICENSING.md` and the licence gate, and was corrected
in the same change that created this package.)
