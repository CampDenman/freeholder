<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->
# The living-screenshots gallery (C3.29)

Every push to `main` and every release tag captures every screen of the app
(`.github/workflows/screenshots.yml`), publishes the images to the
`screenshots` branch, and — once the credential below exists — rebuilds the
public gallery on freeholder.ai under `/screenshots`, served from the site's
own media library. The publisher is `scripts/screenshots-gallery.mjs`; it is
idempotent (an image already in the library is reused, pages the capture no
longer needs are unpublished) and it needs two scopes and nothing else.

## Switching the gallery on (owner, once)

1. On freeholder.ai, open `/admin/connect` and issue a **named, expiring,
   scoped** agent credential:
   - name: `screenshots-gallery`
   - scopes: `media.*` and `cms.*` — nothing else
   - expiry: a year at most; rotate by reissuing
2. In the GitHub repository settings, add:
   - secret `FREEHOLDER_GALLERY_TOKEN` — the token, shown once at issuance
   - variable `FREEHOLDER_GALLERY_URL` — `https://freeholder.ai`
3. The next push to `main` (or **Actions → Screenshots → Run workflow**)
   updates the gallery. Until both values exist the `gallery` job skips, so
   the pipeline stays green without them.

## Verifying

- The workflow run's `gallery` job logs the image count and the page list.
- `https://freeholder.ai/screenshots` shows the index and one page per group
  (customer journey, public site, customer portal, admin), each image served
  from the site's own media pipeline with its generated responsive variants.
- A second run of the same commit uploads nothing.

## Revoking

Revoke the credential at `/admin/connect` and delete the GitHub secret. A
revoked token makes the next gallery run fail on the refusal; a deleted
secret makes the job skip. The published pages stay up either way; delete
the `screenshots` pages in the CMS if they should come down.

The token is a secret: it lives in the Actions secret store and nowhere
else — never in chat, commits, logs or test artifacts.
