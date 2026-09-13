<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Google Play data-safety checklist

*MASTER.md §35, C10.16. Companion: [Apple privacy](app-store-privacy.md).*

This is the Play Console Data safety form, filled from what the binary
actually does. It is not Google's review, and a green CI run is not a review
outcome. Play accepts or rejects the listing; the checklist only makes the
answers we give them match the permissions the binary requests.

CI fails the customer-app job when the demo discovery contract cannot be
parsed, when an asset `freeholder-app init` writes is missing, or when the
privacy manifest does not match those permissions.

## Does the app collect or share user data?

**Yes, collects. Does not share with third parties.** The app talks only to
the Freeholder instance the customer typed. There is no advertising SDK, no
analytics SDK, and no crash reporter.

## Data collected

| Type | Collected? | Shared? | Required? | Purpose |
|---|---|---|---|---|
| Email address | Yes (sign-in) | No | Yes — that is how the customer signs in | App functionality |
| Name | Yes (profile the instance already holds) | No | Yes | App functionality |
| User IDs | Yes (contact id) | No | Yes | App functionality |
| Phone number | No | — | — | — |
| Approximate or precise location | No | — | — | — |
| Photos and videos | No. Proofing galleries are the business's files. Device camera/roll is C10.18. | — | — | — |
| Contacts | No | — | — | — |
| Financial info / payment info | No. Invoices open in the system browser; the app never takes a card. | — | — | — |
| Purchase history | No as a Play data type. The customer can *view* their invoices; that is app functionality on the instance, not a Play collection. | — | — | — |
| App interactions | Optional. Treat as app functionality, not advertising. | No | — | App functionality |
| Device or other IDs | Not until a push carrier is configured. `expo-notifications` is not a dependency. | — | — | — |

## Security practices

- **Encrypted in transit:** yes. Discovery and the session insist on https
  except loopback.
- **Encrypted at rest on the device:** the session is in the platform
  keychain (`expo-secure-store`), never in a JS-reachable file. Private
  snapshots are AES-GCM in the app cache directory.
- **Users can request deletion:** yes, through the instance's privacy-rights
  flow (`/portal/privacy` and the owner's contacts desk). The app does not
  invent a second erasure path.
- **Committed to Play Families / designed for children:** no. This is a
  business's customer app.

## Data sharing and selling

Do not declare data as shared or sold. The instance is the business the
customer already has an account with. A third-party SDK in a customer's
pocket would be a privacy claim the owner would have to make on somebody
else's behalf; §35.1 forbids that SDK.

## Permissions the binary requests

Today: none of camera, photos, location, microphone, contacts, notifications,
or tracking. Android `INTERNET` is added by Expo at prebuild. If a later
item (C10.17 owner ingest, C10.18 capture, a push carrier) adds a dangerous
permission, update this table, the Apple checklist, and
`apps/mobile/app.json` in the same PR — CI compares the manifest to the
plugins, usage strings and source.

## Honest limit

Play's review is Play's. This document and the CI gate keep our answers
honest; they do not predict a review outcome.
