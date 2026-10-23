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
`/orders`, `/account`), the customer portal, setup and the playground, with or
without a locale prefix. The CSP's `'strict-dynamic'` would let a provider
script load others, so these pages never render it and never list the edge
origin. The owner's **Collection disabled** policy is read from the database,
which the Edge proxy cannot see: on the first page after it is chosen the
visitor's consent cookie is rewritten to "disabled", and until then the layout
renders no provider script.

## Form screening (C3.33)

Not available in this release yet.

## Lead sink (C3.34)

Not available in this release yet.

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
