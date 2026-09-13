<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Apple App Store privacy checklist

*MASTER.md §35, C10.16. Companion: [Play data-safety](play-data-safety.md).*

This is the list an owner walks when submitting the customer app. It is not
Apple's review, and a green CI run is not a review outcome. Apple accepts or
rejects the binary; the checklist only makes the answers we give them match
the permissions the binary actually requests.

CI fails the customer-app job when the demo discovery contract cannot be
parsed, when an asset `freeholder-app init` writes is missing, or when
`apps/mobile/app.json` `ios.privacyManifests` does not match those
permissions. That is the tested half of "submission-ready". The other half is
this form.

## What the app is

A white-label client of a Freeholder instance. It asks for the business's web
address, signs the customer in, and calls the instance's public API. There is
no in-app purchase of anything the platform sells — digital sales stay on the
website, which is what the store rules permit for goods consumed outside the
app. There is no third-party analytics SDK and no background location.

## Privacy Nutrition Label

Answer from the privacy manifest in `apps/mobile/app.json`. If you add a
permission, change the manifest in the same PR; CI will fail a mismatch.

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Email address | Yes — sign-in | Yes | No | App functionality |
| Name | Yes — customer profile | Yes | No | App functionality |
| User ID | Yes — the instance's contact id | Yes | No | App functionality |
| Phone number | No — the profile may *display* a number the instance already holds; the app does not collect one | — | — | — |
| Location | No. §35.1 forbids background location. | — | — | — |
| Photos or videos | No. Galleries are the business's files, not the customer's camera roll. Camera-roll ingest is C10.18 and will have to update this table. | — | — | — |
| Contacts | No | — | — | — |
| Product interaction | Optional to declare. Bookings and invoices are app functionality, not tracking. | Yes, if declared | No | App functionality |
| Advertising data | No | — | — | — |
| Diagnostics | No third-party crash SDK | — | — | — |

Tracking is **false**. There are no tracking domains.

## PrivacyInfo / required-reason APIs

Declared because Expo dependencies call them, not because we read them
ourselves:

| API | Reason | Why |
|---|---|---|
| UserDefaults (`CA92.1`) | `expo-secure-store` — the session lives in the platform keychain |
| File timestamp (`C617.1`) | `expo-file-system` — the private cache's bounded files |
| Disk space (`E174.1`) | `expo-file-system` — refuse a write that would blow the 20 MiB vault |

Do not add Face ID (`NSFaceIDUsageDescription`) unless the binary starts
requesting biometric unlock at the OS prompt. A fingerprint is a convenience
over a held session, not a new data type.

## App Review notes

- **Login:** a demo instance (Aurora Coast Photography) or the owner's own
  site. The app asks for the web address on first launch; it is not compiled
  for a single tenant.
- **Screenshots:** `npx freeholder-app init` writes branded placeholders when
  a simulator capture is not available. Real screenshots from seeded content
  are better, not required for the command or for CI.
- **Payments:** invoice payment opens in the system browser. Do not claim
  in-app purchase.
- **Push:** device registration exists on the instance; no production push
  carrier is configured yet, and the binary does not request
  `POST_NOTIFICATIONS`. Adding `expo-notifications` must update the manifest
  in the same change.

## Honest limit

Apple's review is Apple's. This document and the CI gate keep our answers
honest; they do not predict a review outcome.
