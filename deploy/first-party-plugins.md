# First-party plugins

Gift registries, print-on-demand, community spaces, voice/video and marketplace
channel sync are first-party plugins (MASTER.md §36, C3.13). They install with
the instance; disable one from Admin → Plugins if the business does not use it.

**These are not complete products.** C3.13 is open: community still needs rooms,
posts and moderation; voice/video still needs rooms and transcripts on the
conversation spine; print-on-demand is a fixture submit, not Printify-style
fulfillment; marketplace sync currently returns one hardcoded order. Gift
registries already raise ordinary invoices. Rebuild the rest to §36 rather
than treating the fixture adapters as the product.

## Gift registries

Admin → Gift registries opens a list attached to a contact. Items raise
invoices through the existing invoicing module — there is no second checkout.
The public page `/gifts/<slug>` lets a visitor contribute; that path calls
`contacts.resolve` and `invoicing.createDraft`. A duplicate slug is a conflict.
Retry an item that failed to invoice from the same screen.

## Print on demand

Admin → Print on demand queues a job then submits it to the plugin's provider
adapter. The fixture adapter succeeds unless the SKU starts with `fail-`. A
failed job stays failed with the provider's message; Retry sends it again.
`printOnDemand.submitQueued` retries queued and failed jobs on a schedule.
That is a seam, not Printify-style fulfillment: there is no catalog mapping,
print provider, or production status beyond the fixture SKU submit.
Fulfillment status on catalog orders is unchanged: this plugin is the print
provider seam, not a second order table.

## Community

Admin → Community creates open or gated spaces. Open spaces accept a public
join at `/community/<slug>`. Gated spaces stay staff-only. Joining the same
person twice is a conflict, not a second membership. There are no rooms, posts
or moderation tools yet — that is the §36 rebuild, not this join table.

## Voice and video

Admin → Voice and video records an artifact against a contact. The vendor SDK
stays in the plugin. On success the recording is attached to that contact's
conversation and timeline. A provider failure leaves `failed` plus the error;
Retry captures again. Rooms, live calls and transcripts on the conversation
spine are not this artifact row.

## Marketplace channels

Admin → Marketplace channels records a Shopify/Etsy/Amazon/eBay seam, then
handshakes with the plugin adapter. A refused handshake stays `failed` so Retry
can run without creating a second row. Sync currently invoices one hardcoded
fixture order for the buyer contact; it is not a live channel pull.
Credentials are not stored in this fixture adapter; a real provider adapter
replaces it without changing the admin screen.
