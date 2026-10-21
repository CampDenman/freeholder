<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# The update screen

*MASTER.md §39.10, checklist item C10.20.* Lives at `/admin/updates`.

§39.10 asks for *"a status line that is never ambiguous… with the notes and one
button."* This is that screen — and it is where a debt gets paid.

## The debt

C10.01 through C10.11 each shipped with their **F04** recorded as a Doctor
check, *"not a new admin screen (C10.11)"*. Eleven items deferred their human
surface to one checklist line. An owner cannot be expected to run `doctor` in
a terminal to find out they are two security releases behind, so everything
those items built is visible here.

| Item | What it put on this screen |
|---|---|
| C10.01 | the customization seams, via the fork panel's owned-vs-core split |
| C10.02 | the release channel selector |
| C10.03 | the signed-feed list, and an **Unverified signature** pill |
| C10.04 | last-checked time and *Check for updates now* |
| C10.05 | *Run preflight* |
| C10.06 | run history, snapshots, release notes |
| C10.07 | the schema-breaking pill |
| C10.08 | the whole policy editor and the pause switch |
| C10.09 | the fork panel and *Open an upstream merge pull request* |
| C10.10 | what updating and rolling back mean on each target |
| C10.11 | the status line itself, and the rollback horizon |

## Sections

**Status line.** Tone follows posture: `behind-security` is danger,
`behind` is accent, `unknown` is warning, `current` is success. `unknown` is
shown rather than hidden — an instance that has never completed a check has
not been told it is safe.

**This instance.** Version, channel, last checked, deploy target and the
earliest version still reachable by rollback (§39.11). If no deploy target is
declared, a warning says plainly that applying an update will migrate and
smoke but swap nothing — because it will otherwise look like it worked.

**Update available.** The notes link and the one button. Applying carries a
typed confirmation: it cuts a live site over to a new build, and §39's
argument is that this is safe *because* it is deliberate, snapshotted and
reversible — not because it is easy to trigger by accident.

**What the signed feed offered.** Each cached release with its CVSS, whether it
breaks schema, whether its signature verified, and a per-row reason saying
whether it can be applied from this version.

**Policy.** Channel, auto-apply level, the nights and start time (stated in the
business timezone), drain, snapshot retention and notification channels. Pause
and resume are the same save with one field changed, not a second write path —
two ways to change `pausedUntil` is two places for pruning and validation to
diverge.

**Targets.** All six Tier-1 recipes, their strategy, what their rollback needs
and what cutover costs. An owner leaving automatic updates on overnight should
know that Replit means minutes of rebuild and a droplet means seconds.

**Fork lane.** Only when this instance is a git checkout. Drift, missing
security releases, how many diverging files are the owner's (upstream will not
overwrite them) and how many are core (they may conflict).

**History.** Every run this instance has attempted, kept forever, with its
trigger and outcome, plus the release notes drafted along the way.

## Design and access

Every action goes through the same services the CLI (C10.21) and MCP (C10.22)
call — the admin is a caller, never a shortcut. The screen requires the
`platform` module grant. Each action is its own form with its own pending
state: applying an update and saving a policy are days apart in consequence,
and one submit button that could mean either is how an owner cuts over a live
site while trying to change a checkbox.

Colours come from semantic tokens only, so the screen ships in light and dark,
and `/admin/updates` is in the real-browser accessibility sweep.
