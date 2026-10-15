# Paradise Modern capabilities

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Paradise Modern (PM) can provide four optional capabilities to a Freeholder
site. Each one is off until its own setting is on, and a Freeholder without
any `PARADISEMODERN_*` variable never contacts PM. Turning one on never turns
another on.

| Capability | Switch | MASTER.md |
|---|---|---|
| Transactional and campaign mail | `MAIL_ADAPTER=paradise`, `MAIL_BULK_ADAPTER=paradise` | C3.30 |
| Measurement and consented conversions | `PARADISEMODERN_ANALYTICS=on` | C3.31 |
| PM Shield screening and lead capture | `PARADISEMODERN_SHIELD=on`, `PARADISEMODERN_LEADS=on` | C3.32 |
| PM Brain for drafting and the assistant | `adapters.ai: "pm_brain"`, assistant provider "PM Brain" | C3.33 |

## Credentials and settings

```dotenv
# The site's PM key. Server-side only: it is never sent to a browser.
PARADISEMODERN_API_KEY=
# Defaults to https://paradisemodern.com; a trailing /v1 is accepted.
PARADISEMODERN_URL=
# Public by design: the browser scripts are requested with them.
PARADISEMODERN_SITE_ID=
PARADISEMODERN_EDGE_URL=https://pm.example.com
# PM Brain only. Must already be registered in PM (see below).
PARADISEMODERN_BILLING_PROJECT=
```

Keep the key in the host's private secret settings, like every other provider
credential. `PARADISEMODERN_EDGE_URL` must be one HTTPS origin with no path —
the site's own `pm.<domain>` host, never PM's platform domain, so a visitor
only ever meets the site's own hostnames.

Visitors never see PM's name: no visitor-facing copy, email, link or redirect
names it. The admin screens do, because the owner chose the provider.

## Mail (C3.30)

```dotenv
MAIL_ADAPTER=paradise            # account mail
MAIL_FROM="Business <hello@example.com>"   # optional; PM's noreply@ otherwise
MAIL_BULK_ADAPTER=paradise       # campaigns
MAIL_BULK_FROM="Business <news@example.com>"
PARADISEMODERN_MAIL_TOPIC=newsletter
```

The addresses must be on the site's PM sending domain, and that domain must be
active in PM. Register the exact `MAIL_BULK_FROM` in **Admin → Settings →
Mail** and run **Verify**: Freeholder asks PM for the site's domain and its
status and verifies only an address on that domain.

Every message carries PM's `permission` declaration, set by the delivery
worker rather than by the module that queued it:

- **Account mail** declares a reason — `authentication` (password reset,
  magic link, newsletter confirmation link), `account_notice` (invoices,
  reminders, invitations, security notices), `requested_reply` (an inbox
  reply), otherwise `service_notification` — and the business event behind it
  (the delivery's idempotency key or a named reference).
- **Campaign mail** is `marketing` under `PARADISEMODERN_MAIL_TOPIC`. A
  recipient with no current Freeholder marketing-email consent, or whose
  consent was recorded by a method PM cannot accept as direct permission
  (import, verbal, system), is refused before any request. Campaign mail must
  carry the site's own one-click `List-Unsubscribe`; without it the send is
  refused instead of letting PM add its own unsubscribe footer. A template
  test send to an address with no recorded opt-in is refused the same way.

When PM has not yet seen a recipient's opt-in (for example, a subscriber who
confirmed before this was switched on), the adapter records it once with
`POST /api/site-self/email/consent` from the retained `consent_records` row —
its method, time, source page, terms version, wording when it was kept, and
`freeholder-consent:<id>` as the evidence reference — and sends again as a
new request. Freeholder never synthesizes consent: no record, no send.
Withdrawals (unsubscribe, preference change) are mirrored to
`/api/site-self/email/consent/withdraw` through the outbox and retried while PM
is unreachable. The delivery worker also rechecks consent immediately before
every campaign send, so a withdrawal stops the next message even before the
mirror lands.

**Feedback.** PM applies bounces, complaints and its own unsubscribe
withdrawals before every send and has no delivery-event webhook for a site, so
Freeholder's suppression list does not learn about a PM bounce. There is no
webhook URL to configure for this provider.

## Measurement and conversions (C3.31)

```dotenv
PARADISEMODERN_ANALYTICS=on
PARADISEMODERN_SITE_ID=…
PARADISEMODERN_EDGE_URL=https://pm.example.com
```

PM's `track.js` and `capi.js` load from the edge, and the CSP opens the edge
origin, only for a visitor who explicitly chose **Allow analytics and
measurement**. The privacy-first opt-out default's implied state is never
enough. While this is on, the privacy choice explains that the site's
measurement service records the visit and may share an enquiry with the
advertising service that brought the visitor, and the opt-out panel offers
that explicit choice. Choose **Explicit opt-in** under **Traffic → Collection
and retention** to ask every visitor up front. **Collection disabled** turns
PM measurement off too.

For a visitor who allowed it, an accepted (not quarantined) form submission
also sends one `lead` event to `POST /api/capi/{site}/event`, deduplicated by
`freeholder-form:<submission id>`, after the visitor's response has been sent.
The visitor's address, user agent and the click IDs `capi.js` stored are passed
straight to PM and are not stored by Freeholder. This is best effort: a failed
conversion is not retried, and the enquiry itself is unaffected.

Freeholder's own analytics are unchanged by any of this; see
`analytics-governance.md`.

## PM Shield and lead capture (C3.32)

```dotenv
PARADISEMODERN_SHIELD=on
PARADISEMODERN_LEADS=on
```

With Shield on, the public form action asks `POST /api/shield/assess` before
the submission is recorded, sending the visitor's address (the
`TRUSTED_CLIENT_IP_HEADER` value when configured), user agent, a name and the
message text — not the email, phone or other answers. PM must have Shield
enabled for the site. The verdict is sealed with an HMAC bound to the form and
the exact answers and handed to `forms.submit`:

- **allowed** — the honeypot and time trap still decide, as always;
- **flagged** — the submission is stored in quarantine with the reason
  "was flagged by the site's spam screening";
- **PM unreachable, slow or not enabled** — sealed as unavailable, and the
  site's own traps decide alone;
- **no seal** (a script posting to the public API directly) — quarantined with
  "was not checked by the site's spam screening".

Nothing is rejected: quarantined submissions stay reviewable and can be
rescued. API keys and system work are not screened. The assessment has a
four-second limit, so a slow PM delays a visitor's "thank you" by at most that
before the site's own traps decide.

With lead capture on, every accepted submission is copied to
`POST /api/collect/lead` by an outbox listener after it commits. PM's
server-to-server lead path is capped per site and address (60 an hour at the
time of writing); a cap or outage is retried with backoff and a permanent
refusal is logged. The submission is always kept in Freeholder.

## PM Brain (C3.33)

Set `adapters.ai: "pm_brain"` in `freeholder.config.ts` for instance-wide
drafting (translations), or choose **PM Brain** as the assistant's provider in
**Admin → Assistant** with model `pm-brain` (or another PM lane such as
`pm-brain:quality`). Calls go to `/v1/chat/completions` with the site key and:

```dotenv
PARADISEMODERN_BILLING_PROJECT=   # required
PARADISEMODERN_BRAIN_MODEL=pm-brain   # adapters.ai lane; optional
PARADISEMODERN_FALLBACK_POLICY=   # optional: allow | none | runpod-only | self-hosted-only
```

PM refuses a call whose billing project it does not know with HTTP 400
`unknown_project`, so **a slug must be registered in PM's
`shared/billing-projects.ts` for each site before PM Brain is used**.
Freeholder refuses locally with that instruction when the project is unset.
Leave the fallback policy unset for PM's normal routing, which is the default
for public-site AI. The §37 builder and managed workforce connections send the
same project and policy headers.

## Verification checklist

1. With no `PARADISEMODERN_*` variables, confirm the site behaves exactly as
   before and makes no request to PM.
2. Mail: send a password reset and a campaign to your own subscribed address;
   in PM, `GET /api/site-self/email/consent?email=…` shows the grant and both
   send bases. Unsubscribe and confirm the withdrawal appears there.
3. Measurement: in a private window, confirm no request reaches the edge
   before **Allow analytics and measurement**, and that both scripts load
   after it.
4. Shield: submit a normal enquiry and confirm it is received and appears as
   a lead in PM; stop PM access (wrong URL) and confirm a submission is still
   received.
5. PM Brain: ask the assistant one question and confirm the completion is
   billed to the registered project.
