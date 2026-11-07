# Managed preview assistant (C3.45)

This consumer is prepared for review. It has no production acceptance and
does not authorize enabling PM's version 3 generator or clearing a character.
The matching PM backend is `feat/autopilot-preview-video-assistant-20261106`.
Release the compatible consumer before PM emits version 3 specs. Version 1
and 2 specs still install without an assistant.

Version 3 explicitly supplies:

```json
"assistant": {
  "provider": "paradise",
  "enabled": true,
  "dailyCapUsd": 1,
  "contentMode": "sfw"
}
```

Optional `hours` are owner-supplied facts. Missing hours stay unknown. The
installer uses ordinary settings/module services, adds the existing site-chat
block to Contact, and configures the existing assistant provider. Text replies
remain ordinary assistant messages on the contact's canonical conversation.
No chatbot age-confirmation form is added.

The preview's server needs its own scoped `PARADISEMODERN_API_KEY`, plus
`PARADISEMODERN_URL` and exact HTTPS voice/face worker origins in
`PARADISEMODERN_ASSISTANT_ORIGINS`. Install these in the preview's private
provider configuration. Never put the key in a launch spec, browser bundle,
page, screenshot or commit. A key is issued through PM's owner-authorized
preview-key operation, not by another site key. With no worker origins or
cleared talent, the UI offers text. An existing private link and owner claim
remain separate from assistant credentials.

PM owns exact-asset clearance, SFW knowledge/rules, plan allowance, owner
credit, daily list-price cap, GPU admission and authoritative settlement. The
site derives `visitor_ref` from its validated chat cookie; a browser cannot
supply one, an account, a prompt, an arbitrary talent, or a provider key.
`/api/chat/assistant/call` refuses cross-site requests and uses the ordinary
service permission/CSRF/audit path. Owner settings use the same scoped services
from the admin screen and API. Managed amounts are USD cents, independent of
the business's storefront currency, and the managed cap is daily.

For text, Freeholder serializes budget claims and reserves the whole remaining
local cap, passes it as a maximum to PM's quote/admission, and settles the
actual list-price receipt into the existing turn meter. An unknown timeout
keeps the reservation for ledger reconciliation; it never assumes no charge.
That conservative failure can exhaust the local cap until the next period.
No automatic retry, budget reset or unsupported reconciliation is performed.

Voice/video use the byte-pinned PM duplex 0.1.10 distribution in
`public/managed-assistant/0.1.10`, with same-origin codecs and preserved MIT/BSD
notices. Their manifest digests are tested. The site opens only configured
worker origins on Contact (including localized paths before locale rewrite),
suppresses call controls on site-chat blocks placed elsewhere, asks for microphone access after a click, polls
bounded queue tickets, renews leases within the server's hard deadline and
always attempts End and local media cleanup. Browser captions are explicitly
labeled browser observations and deduplicated onto the existing conversation;
they are never billing, identity or consent receipts.

Local validation: existing launch/assistant suites 72 cases on isolated native
PostgreSQL; 10 new managed consumer cases cover v3 compatibility/installation,
byte pins, CSP, actual receipt and unknown-charge holds, concurrent claims,
visitor binding, End after off, owner authorization and caption deduplication.
TypeScript, focused lint, transaction-boundary, locale, licensing and plan
checks are separate from protected CI and production acceptance.

Before closing C3.45, qualify both exact deployed releases, text fallback on
the actual PM-hosted preview, owner off/cap/talent changes, one approved real
call with media readiness, captions, ordinary End, worker stop and one durable
settlement, plus cross-visitor refusals. Sienna's replacement voice still needs
Tony's listening approval and exact-asset clearance. No live call is accepted
from a fake grant or local test.

Peer review qualified the multilingual CSP defect as source integration, not a
live English-preview incident. Contact, /fr/contact and localized variants now
share the exact media policy; unrelated pages retain their ordinary policy.
Focused CSP/browser suites18 pass (7 database cases skipped in that invocation);
native managed tests and full fast gates are recorded separately.

Existing signed-in site-chat HTTP integration also omitted the double-submit
CSRF header on message/assistant/End requests. All chat media/text actions now
reuse a browser-safe token helper; a mounted browser regression runs those
requests through the real requireCsrf guard with a simulated httpOnly login
cookie. Anonymous visitor behavior and server CSRF requirements are preserved.
