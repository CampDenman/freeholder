<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# The Freeholder customer app

White-label Expo application. *MASTER.md §35, §35.1 — checklist item C10.23;
the remaining screens are C10.24.*

```sh
cd apps/mobile
npm install
npm start
```

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

## Built so far

- **Connect** — the first screen. Asks for the business's address and shows
  whatever `discover()` said went wrong, in the customer's terms.
- **Home** — the business's name and branding, and the customer's recent
  records once signed in.
- **Catalog** — what the business sells. Public, because someone who just
  installed the app should see what is on offer before being asked who they
  are.

Booking, invoice pay, galleries and proofing, portal messages and newsletters
are C10.24. The tab bar renders only the screens that exist; a tab leading
nowhere is a dead end.

## Rules the code keeps

- **The session lives in the platform keychain** (`expo-secure-store`), never
  `AsyncStorage` — that is a JSON file in the app sandbox which lands in
  unencrypted device backups.
- **No colour literals.** Every colour comes from the instance's own semantic
  tokens, so a rebrand reaches every phone without a store review.
- **Every screen has a loading, empty and error state.** A screen that renders
  nothing while it waits looks broken.
- **Cached content says when it was fetched.** A gallery from four minutes ago
  is worth proofing; one from last Tuesday is not.

## Limits

`npm start` needs a simulator or Expo Go. CI typechecks the app on every
change; building actual store binaries is C10.16, which is where EAS and the
submission checklists belong.
