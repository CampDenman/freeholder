# First-party plugins

Gift registries, print-on-demand, community spaces, voice/video artifacts and
marketplace channel sync ship as first-party plugins (MASTER.md §36, C3.13).
They are installed with the instance. Disable one from Admin → Plugins if the
business does not use it.

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
Fulfillment status on catalog orders is unchanged: this plugin is the print
provider seam, not a second order table.

## Community

Admin → Community creates open or gated spaces. Open spaces accept a public
join at `/community/<slug>`. Gated spaces stay staff-only. Joining the same
person twice is a conflict, not a second membership.

## Voice and video

Admin → Voice and video records an artifact against a contact. The vendor SDK
stays in the plugin. On success the recording is attached to that contact's
conversation and timeline. A provider failure leaves `failed` plus the error;
Retry captures again.

## Marketplace channels

Admin → Marketplace channels records a Shopify/Etsy/Amazon/eBay seam, then
handshakes with the plugin adapter. A refused handshake stays `failed` so Retry
can run without creating a second row. Sync pulls orders onto invoices for the
buyer contact. Credentials are not stored in this fixture adapter; a real
provider adapter replaces it without changing the admin screen.
