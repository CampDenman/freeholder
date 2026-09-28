# First-party plugins

Gift registries, community spaces, voice/video and marketplace channel
sync are first-party plugins (MASTER.md §36, C3.13). They install with
the instance; disable one from Admin → Plugins if the business does not use it.

**These are not complete products.** Community, voice/video and marketplace
channel sync have landed as first-party plugins. Shopify and Daily have real
HTTP adapters; the Daily adapter remains in-tree as optional non-first-party
code — the de-facto first-party voice/video provider is paradisemodern's
Paradise Comms (owner decision 2026-09-27). Print-on-demand's Printify
adapter likewise remains in-tree as working optional code, but the
print-on-demand product is **deferred to v2** (MASTER.md §43.18, owner
decision 2026-09-27).
Gift registries raise ordinary invoices. Missing live providers fail explicitly; no
channel connection or call is reported as successful. Live acceptance and
remaining product depth stay open under C3.13.

## Gift registries

Admin → Gift registries opens a list attached to a contact. Items raise
invoices through the existing invoicing module — there is no second checkout.
The public page `/gifts/<slug>` lets a visitor contribute; that path calls
`contacts.resolve` and `invoicing.createDraft`. A duplicate slug is a conflict.
Retry an item that failed to invoice from the same screen.

## Print on demand

> **Deferred to v2** (MASTER.md §43.18, owner decision 2026-09-27: "we'll get
> back to printify later"). Print-on-demand leaves the v1 plan; the adapter
> documented below remains in-tree as working optional code, and re-entry
> into the plan happens only by owner decision.

Admin → Print on demand maps a catalog SKU to a Printify product and numeric
variant ID. Set `PRINTIFY_API_TOKEN` and `PRINTIFY_SHOP_ID` in the deployment
environment and restart Freeholder. Obtain the token and shop ID using the
[Printify API guide](https://developers.printify.com/). The screen reports local
configuration; it does not claim the credentials have been verified.

A paid mapped catalog line opens an ordinary catalog fulfillment and submits
its product, quantity, contact email and shipping address to Printify. A complete
name, street, city, postal code and two-letter country are required. Each line
is a separate Printify order with standard shipping. Merchant approval and
production settings in Printify govern when it enters production; Freeholder
does not call the separate send-to-production endpoint.

Acceptance marks the print job submitted and leaves fulfillment pending.
Scheduled checks and **Refresh tracking** apply verified carrier evidence.
All tracking numbers appear on the print job; the first is the catalog
fulfillment's primary tracking number. Fulfilled provider orders with tracking
become shipped. Delivery is recorded only when all returned shipments carry
valid past delivery timestamps. Automatic checks stop after shipment; refresh
manually to check later delivery.

Queued, failed and expired submissions retry twice hourly, in batches of 50.
The original catalog line identity survives timeouts; Printify's documented
matching duplicate response recovers the same vendor order. A ten-minute lease
rejects stale workers. Existing jobs retain their original product/address and
merchant shop binding; changing mappings affects newly queued lines only.
Restore the original shop configuration before retrying a job from another shop.
Review rejected address/product details before retrying: editing an existing
job's snapshot is not currently supported. No live merchant acceptance test
has been performed; mocked HTTP and database tests are not that evidence.

## Community

Admin → Community creates open or gated spaces, rooms inside a space, and a
moderation queue of hidden or reported posts. Open spaces accept a public join
at `/community/<slug>` and show a chronological feed. Gated spaces show a join
request instead of the feed until staff add the person; members must sign in through the existing customer account to read and post.
An email in a form or URL never grants membership or moderator rights. Joining the same person
twice is a conflict, not a second membership. A signed-in moderator (or staff through admin) can hide
or remove a post; hidden posts leave the public feed and stay on the admin
queue. Member posts are rate-limited by signed-in account, stored as plain text, and
land on the session-linked contact timeline.

## Voice and video

The de-facto first-party provider is paradisemodern's Paradise Comms
(owner decision 2026-09-27): prod `https://paradisemodern.com/v1`, staging
`https://comms-staging.paradisemodern.com/v1`; auth is a per-site
`x-api-key` (carrying comms scopes) or a legacy portfolio bearer token;
capabilities `comms.calls/rooms/streams/conversations` per
`/api/integration/capabilities`. Admin → Voice and video opens a private
room attached to the canonical contact. Rooms are created with policy
(open/moderated/invite_only), participant and publisher caps and recording
options plus retention; credentials are TTL JWTs with TURN.

**Open as host** issues an owner token for that room. **Create guest link**
returns a non-owner invitation to copy and share with the contact; Freeholder
does not send it. Treat these links as private credentials. **Record
attendance** is a manual attendance entry, not evidence that the invited
person joined.

**Stop** asks Paradise Comms to end the room: PM persists the terminal
state, then awaits LiveKit `DeleteRoom` and returns `media_ended`; a 503
`media_termination_pending` is retryable. Freeholder does not claim that
deleting a room proves its call ended. **Missed call** performs that
shutdown before writing the timeline event. Recording start/stop rides the
room's recording options; recordings land in DigitalOcean Spaces.

Transcripts are unavailable until PM ships them; a missing transcript stays
absent, never a placeholder. Paradise Comms webhooks are HMAC-SHA256 signed
(`Webhook-Signature: t=<ts>,v1=<hmac>`) and verified as LiveKit ingress.
The prepaid-budget 402 gate applies to site-key callers.

A verified recording is copied automatically into the owner's configured
storage (the same S3-compatible adapter as media). The copy uses content-
addressed keys and a SHA-256 checksum, so retries never duplicate objects; a
failed copy stays visible on the recording with **Copy to storage** to retry
it. Recordings above 512 MiB are not imported; the recording row reports the
failure instead of exhausting the worker. The recording list shows the copy
state per recording. Contact erasure deletes imported owner-storage copies
through the same durable job receipt as provider copies; retention holds keep
them exactly like the provider originals.

**Honesty notes for the PM path.** Paradise Comms has no recording
list/get/delete or erasure API yet — recordings land in DigitalOcean Spaces
and the read/delete endpoints are PM-side work items — so provider-side
erasure of PM recordings lands with PM's recording-delete API; until then a
privacy receipt must name what it did not erase. See [provider erasure and
recovery](provider-recording-erasure.md). The shipped seam and owner-storage
import (PRs #364 and #394) were built against Daily and need the PM adapter
re-targeted; live paradisemodern acceptance remains open C3.13 work.

The Daily adapter remains in-tree as optional non-first-party code: set
`DAILY_API_KEY` and `DAILY_DOMAIN` (for example `your-business.daily.co`)
in the deployment environment to use it. It provides private expiring rooms,
separate host/guest tokens expiring within 30 minutes, recording and
transcript handling, and durable erasure as documented in
[provider erasure and recovery](provider-recording-erasure.md); its Daily
references ([room configuration](https://docs.daily.co/reference/rest-api/rooms/create-room),
[meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token))
remain the authority for that optional path. HTTP and database tests do not
establish a live call or device compatibility on either provider.

## Marketplace channels

Admin → Marketplace channels connects the configured Shopify store and keeps
failed handshakes available for retry. Etsy, Amazon and eBay remain unimplemented
provider seams. The production adapter imports verified paid Shopify orders
through the canonical contact and draft invoice services, as described below.
Only tests use staged in-memory orders. The Shopify connection is a
**migration bridge** — import your Shopify history into the native
Freeholder store, which is the product (owner decision 2026-09-27, C3.24) —
not an ongoing dependency.

### Sync ownership and retries (C3.13)

Print and voice/video retries exclusively claim existing jobs or artifacts.
Marketplace sync claims an expiring lease, renews it after each page, and
checks its ownership before importing or checkpointing. An expired worker
cannot overwrite a recovered sync. Each imported order resolves its contact,
creates its invoice and records the channel order in one transaction.
Print and call adapters recover documented idempotent operations, but HTTP
fixtures do not prove live merchant or call-provider acceptance.

### Shopify own-store setup (C3.13)

This connection exists to migrate your Shopify history into the native
store; it is not an ongoing dependency (owner decision 2026-09-27, C3.24).

Create and install an app for a store in your Shopify organization using the
[client credentials grant guide](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant).
Set `SHOPIFY_SHOP` to its `your-store.myshopify.com` domain, and set
`SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` in your deployment environment.
Restart Freeholder, then connect Shopify in Admin → Marketplace. Local
configuration is distinct from the verified channel connection. Tokens stay
in process memory and renew before expiry; credentials never appear in channel
reads, generated API results or stored provider errors.

The app needs `read_orders`, `read_customers` and access to protected customer
email/name fields. The [Customer API](https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer)
requires the customer scope used to resolve the buyer’s name. Shopify normally
limits history to 60 days; older orders need additional approved access
([Order API](https://shopify.dev/docs/api/admin-graphql/latest/objects/order)).
A missing email stops the page with an actionable error rather than creating
a fabricated contact. Fix permissions or the source order, then retry.

Sync reads up to 50 orders per page using GraphQL Admin API `2026-07`. Only
paid, non-test, non-cancelled orders are imported. Each produces a draft
invoice for the gross shop-currency amount, linked to the resolved contact.
Review channel tax details before issuing anything; Freeholder does not send
an invoice, charge the customer, or assert a local settlement during import.
Later source edits and cancellations do not update previous imports.

After the order pass, the same sync reconciles refunds. Orders with a refunded
or partially-refunded financial status return their refund list; each refund
is recorded once, keyed by its provider refund id. When the imported invoice
has been issued, the refund becomes an issued credit note through the
invoicing module — never a direct money mutation — bounded by the original
invoice total like any other credit note. Multiple refunds on one order
produce separate credit notes. A refund whose order has not imported yet, or
whose invoice is still a reviewable draft, stays listed as pending and
reconciles on a later sync; the admin screen shows the state per refund. No
live store acceptance has been performed; HTTP fixtures and database
integration tests establish local behavior only.

Connected channels sync twice hourly; active leases are left to their owner.
Completed scans start from the beginning on the next run; existing imports
are skipped by channel/order identity. Interrupted scans retain the last
completed page. A sync stops after 500 pages, so large histories need a future
incremental history workflow. Shop identity must match the connected channel
on every page. Restore the original configuration if it changes. Connection
and sync leases reject competing or expired workers. No live store acceptance
has been performed; HTTP fixtures and database integration tests establish
local behavior only.
