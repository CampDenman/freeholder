<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# The security escalation, and update tools for agents

*MASTER.md §39.10, checklist item C10.22.*

§39.10's fourth surface: *"a security release outstanding beyond a set period
escalates to a notification, because silence must not be indistinguishable
from safety."*

That last clause is the whole design. Every other part of the updater is
something an owner has to go and look at — a screen, a CLI, a tool an agent
calls. This is the one part that comes and finds them, because the failure mode
of an updater is not a wrong answer. It is nobody asking the question for three
months.

## Severity sets the clock

| Band | CVSS | Escalates after |
|---|---|---|
| critical | 9.0+ | 24 hours |
| high | 7.0–8.9 | 48 hours |
| medium | 4.0–6.9 | 96 hours |
| low | below 4.0 | 168 hours |

Treating a 2.1 like a 9.8 is how an owner learns to archive these unread — at
which point the escalation has made things worse than silence, not better.

The notification is `critical` priority for everything but the low band, so it
escapes a digest. A CVSS 9 release that waits for the weekly summary has not
been escalated, it has been filed.

## What it will and will not do

- **It names the worst overdue release**, not the oldest one on the list.
- **It ignores unscored releases.** A release with no CVSS is news, not
  exposure.
- **It escalates once a day at most.** The idempotency key is bucketed by
  version and day, so the hourly job does not nag — and a *newer* security
  release still gets its own alarm rather than being swallowed by an earlier
  one's dedupe.
- **It keeps escalating while updates are paused.** §39.6 lets an owner turn
  automatic applying off. It does not let the platform stop saying they are
  exposed — that sentence is what made pausing a safe thing to offer.
- **It goes to owners**, not staff: applying an update needs the `platform`
  grant, so telling anyone else would be telling somebody who cannot act.

Job: `core.escalateSecurityUpdates`, hourly.
Topic: `platform.securityUpdate`, linking to `/admin/updates`.

## Update tools for agents

Every update service is an MCP tool, generated from the registry like the rest
of the platform (§28.3) — so *"am I up to date?"* and *"apply security updates
tonight"* are things an owner can say to their own assistant.

**Reading status and applying an update are separate scopes**, as §39.10
requires. API-key scopes are per service name or per family:

| Scope | Can |
|---|---|
| `platform.updateStatus` | read status only |
| `platform.applyUpdate` | apply, and nothing else |
| `platform.*` | everything the platform family exposes |

A monitoring key scoped `platform.updateStatus` cannot cut a site over. That is
enforced by `permits()` and pinned in
`tests/core/update-escalation.test.ts`, not left to convention.
