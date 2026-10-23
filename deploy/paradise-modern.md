# Paradise Modern as an optional provider

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder presents every outside service as a neutral category with
swappable adapters (MASTER.md §12): payments (Stripe, PayPal, …), mail
(SMTP, Gmail, Outlook, Resend, Postmark, SES), storage (any S3-compatible
host), measurement, form screening, a lead sink and the agent/model gateway.
Paradise Modern is one optional adapter in several of those categories,
configured the same way as any other provider. A site that never chooses it
never contacts it, and choosing it for one category never turns on another.

This page documents only the public API contract Freeholder uses and the
settings an operator sets.

| Category | Choose Paradise with | MASTER.md |
|---|---|---|
| Transactional / bulk mail | `MAIL_ADAPTER=paradise`, `MAIL_BULK_ADAPTER=paradise` | C3.31 |
| Measurement | `MEASUREMENT_PROVIDER=paradise` | C3.32 |
| Form screening | `FORM_SCREENING_PROVIDER=paradise` | C3.33 |
| Lead sink | `LEAD_SINK_PROVIDER=paradise` | C3.34 |
| Agent / model gateway | `FREEHOLDER_AGENT=paradise`, or a `paradise` workforce connection | C4.05 |

## Credentials and settings shared by every category

```dotenv
# The site's key. Server-side only: it is never sent to a browser.
PARADISEMODERN_API_KEY=
# Defaults to https://paradisemodern.com. A trailing /v1 is accepted.
PARADISEMODERN_URL=
# Model gateway only: the project gateway calls are metered against, sent as
# x-pm-project. The gateway refuses a call naming no project it knows.
PARADISEMODERN_PROJECT=
```

Keep the key in the host's private secret settings, like every other
provider credential.

Every server-to-server call goes through one helper
(`src/adapters/paradise/http.ts`):

- `PARADISEMODERN_URL` must be `https://` (plain `http://` is accepted only
  for a loopback host, for tests and local development);
- the key is sent as `x-api-key` to that origin and nowhere else — a path
  can never name another host, and redirects are refused, not followed;
- responses are size-bounded, and an error carries the HTTP status and the
  provider's machine code, never the response body;
- calls run outside service transactions (jobs, outbox listeners, or the
  step before a submission's transaction), never inside one;
- on a public playground (`FREEHOLDER_PLAYGROUND=1`) every call is refused
  before any request, as mail, SMS and webhooks are.

## Mail (C3.31)

Not available in this release yet.

## Measurement (C3.32)

Not available in this release yet.

## Form screening (C3.33)

```dotenv
FORM_SCREENING_PROVIDER=paradise
```

Freeholder's own honeypot and signed time trap run on every submission
whatever is configured. With screening on, the public form action asks the
provider about each anonymous submission *before* the submission's
transaction opens, with a 4-second limit, by calling
`POST /api/shield/assess`. **What is sent:** a form reference
(`freeholder:<form slug>`), the visitor's IP address (the provider's API
requires it) and the text of the submission's longest prose answer — the
words being screened. No user agent, name, email, phone or other answer is
sent. **Why:** to catch spam that gets past the traps.

The answer reaches `forms.submit` sealed: an HMAC under `SESSION_SECRET`
bound to the form and the exact answers, valid for 15 minutes. A "blocked"
verdict adds the quarantine reason "was flagged by the site's spam
screening"; it never removes a reason a trap raised, and quarantine keeps the
submission for review rather than dropping it. A provider that is down, slow,
not enabled for the site or answering without a verdict seals "unavailable",
and the traps decide alone. Fail-closed rules: without `SESSION_SECRET` no
seal is ever issued, and while screening is on an anonymous submission that
arrives without a valid seal (for example straight through the public API)
is held as "was not checked by the site's spam screening". Signed-in people
and API keys are not screened.

While it is on, every form shows a short notice under its fields naming the
provider, what is sent and why, in every locale.

## Lead sink (C3.34)

```dotenv
LEAD_SINK_PROVIDER=paradise
```

A switch of its own, off by default; screening never turns it on. After an
accepted (never quarantined) submission has committed, an outbox listener
copies it to `POST /api/collect/lead`. **What is copied:** the name, email
and phone answers (when the form has them), the longest prose answer, every
non-empty answer keyed by its field label, the form's slug, the absolute
address of the page it was sent from, and Freeholder's submission id so the
copy points back at the original. **Why:** so an owner who keeps enquiries in
that CRM finds them there.

The submission is always kept in Freeholder first. A transient failure
(unreachable, HTTP 408, 429 or 5xx) is retried by the outbox with backoff; a
permanent refusal is logged and not retried. While it is on, every form shows
a notice naming the provider and listing what is copied, in every locale.

## Agent / model gateway

`FREEHOLDER_AGENT=paradise` (or a `paradise` workforce connection) calls
`POST /v1/chat/completions` with `x-api-key`, a `request_id`, and
`x-pm-project` when `PARADISEMODERN_PROJECT` is set, at the
`PARADISEMODERN_URL` origin (the provider's default host when unset). No
other gateway ever receives that header. A `paradise` workforce connection
whose base URL names a different origin must name a credential of its own;
it never receives `PARADISEMODERN_API_KEY` or the project header.
`PARADISEMODERN_URL` is validated at boot: `https://` only, `http://` only
for a loopback host. Project ids are sent exactly as written; letters, digits,
`-` and `_` are accepted. See `deploy/agent-launch.md` and MASTER.md §37.
