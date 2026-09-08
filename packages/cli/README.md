<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# `freeholder update`

Check, preflight, apply and roll back a [Freeholder](https://github.com/CampDenman/freeholder)
instance from a terminal or a cron job.

```sh
npm install -g @freeholder/cli

freeholder update --check
freeholder update --preflight
freeholder update --apply
freeholder update --rollback
freeholder update            # status, the default
```

This is a thin client, not a second implementation. The update logic lives in
the instance, because only the instance knows its own database, adapters and
deploy target. This establishes an authenticated caller and prints what the
platform says.

## Connecting

```sh
freeholder update --url https://example.com --api-key fh_...
FREEHOLDER_URL=... FREEHOLDER_API_KEY=... freeholder update --check
```

`--email` / `--password` also work, with `--totp-secret` when the owner is
enrolled in two-factor. **In cron, use a scoped API key** — reading update
status and applying an update are separate scopes, so a monitoring key does
not have to be able to cut a site over.

## Exit codes

Meant for a crontab and a monitor:

| Code | Means |
|---|---|
| `0` | Up to date, or the action succeeded |
| `1` | An update is available and was not applied |
| `2` | A security release is outstanding, or an action failed |
| `3` | The instance could not be reached or would not authenticate |

`1` and `2` are separate on purpose. A monitor should be able to page on *"a
security release is outstanding"* without also paging every time a feature
release ships — an operator who collapses those into one alert learns to
ignore both.

An instance that has simply never checked exits `0`. The first cron run
resolves that on its own, and exiting non-zero would make every fresh install
look broken.

`--json` prints the raw service response for anything that consumes it;
`--quiet` suppresses the status summary.

## Licence

Apache-2.0. See `LICENSE`.
