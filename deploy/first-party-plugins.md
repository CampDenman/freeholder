# First-party plugins

Gift registries, print-on-demand, community spaces, voice/video and marketplace
channel sync are first-party plugins (MASTER.md §36, C3.13). They install with
the instance; disable one from Admin → Plugins if the business does not use it.

**These are not complete products.** Community, voice/video, print-on-demand
and marketplace channel sync have landed as first-party plugins. Printify and
Shopify and Daily have real HTTP adapters.
Gift registries raise ordinary invoices. Missing live providers fail explicitly; no print
submission, channel connection or call is reported as successful. Live acceptance and remaining product depth stay open under C3.13.

## Gift registries

Admin → Gift registries opens a list attached to a contact. Items raise
invoices through the existing invoicing module — there is no second checkout.
The public page `/gifts/<slug>` lets a visitor contribute; that path calls
`contacts.resolve` and `invoicing.createDraft`. A duplicate slug is a conflict.
Retry an item that failed to invoice from the same screen.

## Print on demand

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

Set `DAILY_API_KEY` and `DAILY_DOMAIN` (for example `your-business.daily.co`)
in the deployment environment and restart Freeholder. Admin → Voice and video
opens a private room attached to the canonical contact. The API key's domain
is checked before each provider operation. Rooms expire after 24 hours, allow
up to 20 participants, and start with microphones and cameras off.

**Open as host** issues an owner token for that room. **Create guest link**
returns a non-owner invitation to copy and share with the contact; Freeholder
does not send it. Links expire within 30 minutes and never outlive the room.
Treat these links as private credentials. **Record attendance** is a manual
attendance entry, not evidence that the invited person joined.

The host starts recording and transcription in Daily's call controls.
**Stop** expires the room, ejects its participants and checks that none remain.
**Missed call** performs that shutdown before writing the timeline event.
An unavailable or missing provider room stays failed for reconciliation;
Freeholder does not claim that deleting a room proves its call ended.

**Check recording** retrieves a verified finished recording and any available
WebVTT transcript. A recording still processing can be retried. **Refresh
transcript** checks for later transcript text without duplicating the contact
conversation or transcript artifact. Missing transcripts remain absent.
**Download recording** obtains a fresh expiring provider link.

Room creation uses a stable room name and recovers a lost creation response by
reading that same private room. Ten-minute leases fence room and recording
workers; stale results cannot overwrite recovered work. Scheduled retries run
twice hourly for recent failures and expired leases. Contact merge repoints
room, attendance and artifact contact references.

Recordings currently remain in Daily storage; local backup/export includes
metadata and captured transcript text, not the recording bytes. Contact erasure
of local rows does not yet remove Daily's recordings. Owner storage import and
provider erasure are unfinished C3.13 work. HTTP and database tests do not
establish a live call, device compatibility or recording acceptance.
See [Daily room configuration](https://docs.daily.co/reference/rest-api/rooms/create-room)
and [meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token).

## Marketplace channels

Admin → Marketplace channels connects the configured Shopify store and keeps
failed handshakes available for retry. Etsy, Amazon and eBay remain unimplemented
provider seams. The production adapter imports verified paid Shopify orders
through the canonical contact and draft invoice services, as described below.
Only tests use staged in-memory orders.

### Sync ownership and retries (C3.13)

Print and voice/video retries exclusively claim existing jobs or artifacts.
Marketplace sync claims an expiring lease, renews it after each page, and
checks its ownership before importing or checkpointing. An expired worker
cannot overwrite a recovered sync. Each imported order resolves its contact,
creates its invoice and records the channel order in one transaction.
Print and call adapters recover documented idempotent operations, but HTTP
fixtures do not prove live merchant or call-provider acceptance.

### Shopify own-store setup (C3.13)

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
Later source edits, refunds and cancellations do not update previous imports.
These limitations are shown in the admin screen and remain under C3.13.

Connected channels sync twice hourly; active leases are left to their owner.
Completed scans start from the beginning on the next run; existing imports
are skipped by channel/order identity. Interrupted scans retain the last
completed page. A sync stops after 500 pages, so large histories need a future
incremental history workflow. Shop identity must match the connected channel
on every page. Restore the original configuration if it changes. Connection
and sync leases reject competing or expired workers. No live store acceptance
has been performed; HTTP fixtures and database integration tests establish
local behavior only.
