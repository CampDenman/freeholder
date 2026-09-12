<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# The Freeholder customer app

White-label Expo application. *MASTER.md §35, §35.1 — checklist item C10.23;
customer contracts and writes are C10.24; remaining screens are C10.25–C10.28.*

```sh
cd apps/mobile
npm install
npm start
```

Metro and TypeScript both consume `packages/mobile-app/src`. To check both native
bundles without a simulator, run `npx expo export --platform android --platform
ios` from this directory.

## Why this is not in the pnpm workspace

Every CI job in this repository runs `pnpm install --frozen-lockfile` at the
root. React Native and Expo are roughly six hundred packages that only this app
needs, and putting them in `packages/*` would bill that install to all
twenty-odd jobs.

So `apps/` sits outside the workspace with its own `package-lock.json`, and CI
gives it one dedicated job. `packages/mobile-app` stays the dependency-free
client layer this app consumes — a test asserts it imports nothing but its own
files and node builtins.

## What is here, and what is not

This app is a **client**. §35.1: *"There is no mobile-only endpoint, no
mobile-only business rule, and no mobile-only notion of a customer."*

| Layer | Where |
|---|---|
| Discovery, session, offline, branding | `@freeholder/mobile-app` (C10.12) |
| Which services each screen may call | `@freeholder/mobile-app` (C10.13) |
| React binding, navigation, views | here |

`src/lib/screen-data.ts` is what makes the contract load-bearing rather than
documentation: a screen asks for a service **by name**, and a name its contract
does not list throws before any request is made. A view cannot quietly grow a
dependency — it has to change the contract, in a diff somebody reviews.

`useScreenWrite` is the shared mutation path (C10.24). Pass the current caller
and network `online` state, then call `execute(params)` only from a deliberate
tap. It checks the write contract, requires a customer session on signed-in
screens, refuses offline through `OfflineWriteRefused`, and exposes pending
and error state. It neither caches nor retries a mutation, including ambiguous
network failures. The instance still enforces authorization and idempotency.

Contract labels use `useAppText()` with the instance's default locale. Edit
the `app.*` strings in `locales/en.json`, `es.json`, and `fr.json`, then run
`node scripts/generate-mobile-messages.mjs` from the repository root. The
generated subset keeps the full web/admin catalogs out of the phone bundle;
the contract test rejects a stale subset or a missing screen label.

## Built so far

- **Connect** — the first screen. Asks for the business's address and shows
  whatever `discover()` said went wrong, in the customer's terms.
- **Home** — the business's name and branding, and the customer's recent
  records once signed in.
- **Catalog** — what the business sells. Public, because someone who just
  installed the app should see what is on offer before being asked who they
  are.

Bookings (C10.25) use the customer's profile and own list, then uncached
management links. The detail reads live, applies the server's rescheduling
policy, confirms cancellation, and opens existing intake/waiver web forms.
The native picker uses the appointment's timezone; the preview also shows the
business timezone. Messages and newsletters remain C10.28. Invoices (C10.26)
read the existing customer portal room and customer invoice projection. A
separate, uncached own-invoice link opens payment in the system browser without
exposing the user's session. Invoice and receipt pages return to the app's
invoice list; a return naming another business is refused. The app refreshes on
return and never assumes a browser redirect means the invoice was paid. C10.25
and C10.26 still need physical device interaction and accessibility checks
before their checkboxes close.

Galleries (C10.27) list the C10.29 portal room and open a gallery with
`galleries.openWithLogin`, then `viewSession` / `viewItem`. Favourites, selects,
rejects, comments and round submit use the same mutations as `app/g/[slug]`.
Proofing writes are live-only: they are never queued or retried. Private image
bytes come from `/g/{slug}/view/{itemId}` with `Authorization: Bearer
{gallerySessionToken}` — the gallery capability, never the user's login token,
and never in the URL. Those bytes share C10.30's 60-second encrypted lease;
401/403/404 evict immediately, offline failures never renew the lease, expiry
clears the photo while the screen stays open, and sign-out cannot let a late
response refill the next account. Physical-device proofing and accessibility
checks remain outstanding, so C10.27 stays open.

Private read snapshots persist as AES-GCM ciphertext in the app cache directory,
with a session-specific key in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
The vault allows at most 64 files/20 MiB, with an 8 MiB per-entry ceiling.
Private content expires 60 seconds after the request began, including time spent
receiving and persisting it. A failed/offline read never renews that lease.
HTTP 401 invalidates the active session's vault; 403/404 remove the denied read.
Sign-out and account/instance changes invalidate old callers immediately, then
remove their ciphertext. Late responses cannot refill the old vault or erase
the next account's cache. Storage failures disable persistence without losing
successful live reads or falling back to plaintext.

Private screens hide while backgrounded, revalidate on foreground, and clear
expired content even when left open. Offline restart can restore remembered
public branding for the same instance/session; every private read still needs
an unexpired snapshot. An authoritative compatibility/setup refusal cannot be
hidden by the discovery cache. Physical device cold-start, keychain, lifecycle
and accessibility verification remains open under C10.30.

Home and bookings offer password sign-in or an email link. Copy the original
email link into the app: it is checked against the connected business and
consumed once by the existing customer auth service. A two-factor challenge
never becomes a session; those accounts currently use the website. User
sessions travel as bearer credentials with cookies omitted, and are stored
only for their issuing instance. Browser cookie requests retain CSRF checks.

## Rules the code keeps

- **The session lives in the platform keychain** (`expo-secure-store`), never
  `AsyncStorage` — that is a JSON file in the app sandbox which lands in
  unencrypted device backups.
- **No colour literals.** Every colour comes from the instance's own semantic
  tokens, so a rebrand reaches every phone without a store review.
- **Every screen has a loading, empty and error state.** A screen that renders
  nothing while it waits looks broken.
- **Cached content says when it was fetched.** Private snapshots have a
  60-second lease and disappear when it expires.

## Limits

`npm start` needs a simulator or Expo Go. CI typechecks and bundles Android
and iOS on every change; building actual store binaries is C10.16, where EAS and the
submission checklists belong.
