<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# `freeholder-app init`

Point the white-label customer app at a [Freeholder](https://github.com/CampDenman/freeholder)
instance. *MASTER.md §35, checklist item C10.15.*

```sh
npx freeholder-app init https://example.com
npx freeholder-app init --url https://example.com --dir apps/mobile
```

The command reads `/.well-known/freeholder` (the same public discovery document
the app uses), writes icons and splash from the logo when it is a PNG — or from
the brand colours when it is not — writes store listing copy from the business
profile, writes placeholder screenshots from the same branding, and prints an
auditable diff of `app.json` and `eas.json`.

It does **not** require EAS credentials, and it does not run `eas build`.
Producing store binaries is a later step (C10.16).

## What it writes

| Path | From |
|---|---|
| `assets/icon.png` | Logo, or a mark in the brand accent |
| `assets/adaptive-icon.png` | Same, sized for Android's safe zone |
| `assets/splash.png` | Full-screen splash on the brand surface |
| `store/metadata.json` | Name, tagline, descriptions, privacy URL |
| `store/screenshots/*.png` | Placeholder frames in the brand colours |
| `app.json` | Name, slug, icon, splash, package ids, instance URL |
| `eas.json` | Build profiles with no secrets |

Re-running is safe: branding fields in `app.json` update, and an existing
`eas.json` is filled in rather than overwritten, so credentials you add later
are not clobbered.

## Connecting

```sh
freeholder-app init https://example.com
FREEHOLDER_URL=https://example.com freeholder-app init
freeholder-app init --url https://example.com --dir ./apps/mobile --json
```

Discovery is public. No API key is required, and none is accepted — this
command only reads what a signed-out visitor already can.

`--dir` defaults to `apps/mobile` when that Expo app is present, otherwise the
current directory if it already has an Expo `app.json`.

## Exit codes

| Code | Means |
|---|---|
| `0` | Assets and config written |
| `1` | Usage error |
| `2` | The address is not a usable Freeholder instance |
| `3` | The instance could not be reached |

`--json` prints the same result as a machine-readable object, including the
config diff.

## Licence

Apache-2.0. See `LICENSE`.
