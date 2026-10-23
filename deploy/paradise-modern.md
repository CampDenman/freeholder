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

```dotenv
MAIL_ADAPTER=paradise                        # account mail
MAIL_FROM="Business <hello@example.com>"     # optional; the provider's noreply@ otherwise
MAIL_BULK_ADAPTER=paradise                   # campaigns
MAIL_BULK_FROM="Business <news@example.com>"
PARADISEMODERN_MAIL_TOPIC=newsletter         # default "newsletter"
```

The addresses must be on the site's sending domain at the provider, and that
domain must be active there. Register the exact `MAIL_FROM` or
`MAIL_BULK_FROM` in **Admin → Settings → Mail**: Freeholder reads the site's
domain and its status (`GET /api/site-self/me`) and verifies only an address
on that domain, for account mail as well as campaigns. Registering an
account-mail sender queues the check at once; a campaign sender is checked
with **Verify**. A registered Paradise Modern sender cannot send, or become
the default, until it is verified.

Messages go to `POST /api/site-self/email/send` with `to`, `subject`, `text`,
optional `html`, `from`/`fromName`, `replyTo`, the site's
`listUnsubscribe`/`listUnsubscribePost` on campaign mail, a `requestId`
(`freeholder:<delivery id>`, the provider's idempotency key) and a
`permission` declaration set by the delivery worker, not by the module that
queued the message:

- **Account mail** declares a reason — `authentication` (password reset,
  magic link, newsletter confirmation link), `account_notice` (invoices,
  reminders, invitations, security notices), `requested_reply` (an inbox
  reply), otherwise `service_notification` — and the business event behind it
  (the delivery's idempotency key or a named reference).
- **Campaign mail** is `marketing` under `PARADISEMODERN_MAIL_TOPIC`. A
  recipient with no current Freeholder marketing-email consent, or whose
  consent was recorded by a method the provider cannot accept as direct
  permission (import, verbal, system), is refused before any request.
  Campaign mail must carry the site's own one-click `List-Unsubscribe`;
  without it the send is refused rather than letting the provider add its own
  unsubscribe footer.

When the provider answers `EMAIL_CONSENT_REQUIRED` because it has not yet seen
a recipient's opt-in (for example, a subscriber who confirmed before this was
switched on), the adapter records it once with
`POST /api/site-self/email/consent` from the retained `consent_records` row —
its method, time, source page, terms version, wording when it was kept, the
IP address the opt-in came from when one was recorded, and `freeholder-consent:<id>` as the
evidence reference; the source page is sent without its query string or
fragment — and sends again under a new `requestId`. Freeholder remembers each
grant it recorded there (`mail_provider_grants`) and the address it was
recorded under. Freeholder never synthesizes consent: no record, no send.

A withdrawal (unsubscribe, preference change) is mirrored to
`POST /api/site-self/email/consent/withdraw` only for those remembered grants,
with the grant's address — so a contact whose email has changed since is
withdrawn where the provider holds them, and a denial or a contact never
granted there sends nothing. It runs through the outbox and is retried while
the provider is unreachable; a permanent refusal is recorded on the grant and
logged once rather than retried into a dead letter; the public playground
skips it.

**Privacy.** The remembered grants are the person's data. They are included
in a data export (`mail.provider_grants`). Erasure detaches any grant the
carrier still holds from the contact and queues a job that withdraws it at
the carrier and then deletes the row; the erasure receipt stays "pending"
until that job finishes. Deleting a contact detaches its grants the same way,
and a sweep every ten minutes withdraws and deletes them. A grant is
withdrawn through the Paradise Modern credentials whichever adapter is the
campaign carrier now, since a grant recorded there stays there after a
switch. Without `PARADISEMODERN_API_KEY` the detached grants are kept, the
erasure stays pending, and `freeholder doctor` warns
(`mail.providerGrants`) until the key is set and the next sweep finishes
them; the public playground never touches them. Withdrawn or
refused grants age out under the `mail_provider_grants` retention kind. The delivery worker also rechecks consent immediately before
every campaign send, so a withdrawal stops the next message even before the
mirror lands.

**Feedback.** The provider applies bounces, complaints and its own unsubscribe
withdrawals before every send and offers no delivery-event webhook, so
Freeholder's suppression list does not learn about a bounce there. There is no
webhook URL to configure for this adapter. An empty prepaid balance (HTTP 402)
is retried until the job's retry ceiling.

## Measurement (C3.32)

```dotenv
MEASUREMENT_PROVIDER=paradise
PARADISEMODERN_SITE_ID=…                 # the site's public id at the provider
PARADISEMODERN_EDGE_URL=https://edge.example.com   # the site's own edge host, one https origin
```

The provider's `track.js` (`/sdk/track.js?site=<id>`) and `capi.js`
(`/capi.js?site=<id>`) load from the edge host, nonced, and the CSP adds that
origin (`script-src`, `connect-src`, `img-src`; never on admin pages), only for
a visitor who explicitly chose **Allow analytics and measurement**
(`fh_ac=granted`). The privacy-first opt-out default's implied state is never
enough, **Collection disabled** turns measurement off, and the public
playground never loads it. While it is on, the privacy choice names the
category and the provider and explains what allowing it means; the opt-out
panel offers that explicit choice. Choose **Explicit opt-in** under **Traffic
→ Collection and retention** to ask every visitor up front.

For a visitor who allowed it, an accepted (not quarantined) form submission
also sends one `lead` event to `POST /api/capi/{site}/event` after the
visitor's response has been sent, deduplicated by the event id
`freeholder-form:<submission id>`. **What is sent:** SHA-256 hashes of the
enquiry's email (trimmed, lowercased) and phone (digits only) answers when the
form has them, sent as `custom.identifierHashes` (`em`, `ph`) — never the
plain values; the visitor's IP address and browser user agent; the page
address; the click IDs the provider's script stored on the site's own domain
(recognised keys only); and the submission id. Freeholder stores none of the
address, user agent or click IDs it forwards. This is best effort: a failed
conversion is not retried, and neither a failure to send nor a failure to plan
it affects the saved enquiry.

**Pages it never runs on**, whatever the visitor chose: admin, the member and
account areas (`/messages`, `/call`, `/m`, `/feed`, `/community`, `/join`,
`/orders`, `/account`), every page where an address or payment is entered
(`/checkout`, `/cart`, `/buy`, `/book`, `/gifts`, `/memberships`), the
customer portal, setup and the playground, with or without a locale prefix. The CSP's `'strict-dynamic'` would let a provider
script load others, so these pages never render it and never list the edge
origin. The owner's **Collection disabled** policy is read from the database,
which the Edge proxy cannot see: on the first page after it is chosen the
visitor's consent cookie is rewritten to "disabled", and until then the layout
renders no provider script.

## Form screening (C3.33)

```dotenv
FORM_SCREENING_PROVIDER=paradise
```

Freeholder's own honeypot and signed time trap run on every submission
whatever is configured. With screening on, the site's own forms (a form block
on a page and the booking intake form) ask the provider about each anonymous
submission *before* the submission's transaction opens, with a 4-second
limit, by calling `POST /api/shield/assess` — but only after the traps and a
per-client budget (30 calls per form per 10 minutes, as `forms.submit`
allows): a submission the traps already flag, or a client over its budget,
is never sent. **What is sent:** a form reference (`freeholder:<form slug>`),
the visitor's IP address (the provider's API requires it) and the text of the
longest multi-line answer — the words being screened; a form with no
multi-line field sends no text. No user agent, name, email, phone or other
answer is sent. **Why:** to catch spam that gets past the traps.

The answer reaches `forms.submit` sealed: an HMAC under `SESSION_SECRET`
bound to the form and the exact answers, valid for 15 minutes. A "blocked"
verdict adds the quarantine reason "was flagged by the site's spam
screening"; it never removes a reason a trap raised, and quarantine keeps the
submission for review rather than dropping it. A provider that is down, slow,
not enabled for the site or answering without a verdict seals "unavailable",
and the traps decide alone. Fail-closed rules: without `SESSION_SECRET` no
seal is ever issued, so while screening is on every anonymous submission is
held as "was not checked by the site's spam screening"; a seal that is
present but invalid is held the same way. Screening covers anonymous
submissions on every path: an anonymous call to `forms.submit` through the
public API or MCP carries no seal, so while screening is on it is held as
unchecked too, for the owner to review. Only authenticated callers — owner
and staff sessions, API keys and agents — are exempt from the seal. The traps
and the per-form rate limit apply to every caller.

While it is on, every form shows a short notice under its fields naming the
provider, what is sent and why, in every locale.

## Lead sink (C3.34)

```dotenv
LEAD_SINK_PROVIDER=paradise
```

A switch of its own, off by default; screening never turns it on. After an
accepted (never quarantined) submission from a site form — one that showed
the notice below, proven by the same seal — has committed, an outbox listener
copies it to `POST /api/collect/lead`. Owner entries and API or MCP
submissions are never copied. Nor is a submission an owner later rescues
from the spam queue: rescuing it puts the person on the contact spine but
does not copy it to the lead sink. **What is copied:** the name, email
and phone answers (when the form has them), the longest prose answer, every
non-empty answer keyed by its field label, the form's slug, the absolute
address of the page it was sent from, and Freeholder's submission id so the
copy points back at the original. **Why:** so an owner who keeps enquiries in
that CRM finds them there.

The submission is always kept in Freeholder first. Every failed copy is
retried by the outbox with backoff and, after its last attempt, kept as a
dead letter under **Jobs → Outbox** for 90 days, where the owner can replay
it once the cause is fixed; no lead is dropped silently. Its error names the
HTTP status and the provider's code, never the visitor's answers. While it is
on, every form shows a notice naming the provider and listing what is
copied, in every locale.

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
