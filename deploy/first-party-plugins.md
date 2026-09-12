# First-party plugins

Gift registries, print-on-demand, community spaces, voice/video and marketplace
channel sync are first-party plugins (MASTER.md §36, C3.13). They install with
the instance; disable one from Admin → Plugins if the business does not use it.

**These are not complete products.** Community rooms/posts/moderation,
voice/video rooms/recordings/transcripts, and print-on-demand catalog
fulfillment have landed (the POD adapter is still a fixture, not a live
Printify connection). C3.13 is still open: marketplace sync currently returns
one hardcoded order. Gift registries already raise ordinary invoices. Rebuild
that remaining seam to §36 rather than treating the fixture adapter as the
product.

## Gift registries

Admin → Gift registries opens a list attached to a contact. Items raise
invoices through the existing invoicing module — there is no second checkout.
The public page `/gifts/<slug>` lets a visitor contribute; that path calls
`contacts.resolve` and `invoicing.createDraft`. A duplicate slug is a conflict.
Retry an item that failed to invoice from the same screen.

## Print on demand

Admin → Print on demand maps a catalog SKU onto a provider product, then
queues jobs. A paid order line whose SKU is mapped opens an ordinary catalog
fulfillment and submits it to the plugin adapter. Status comes back on that
fulfillment and the catalog order — there is no second order table. The
fixture adapter succeeds unless the SKU starts with `fail-`. A failed job
stays failed with the provider's message; Retry sends the same job again.
`printOnDemand.submitQueued` retries queued and failed jobs on a schedule.

## Community

Admin → Community creates open or gated spaces, rooms inside a space, and a
moderation queue of hidden or reported posts. Open spaces accept a public join
at `/community/<slug>` and show a chronological feed. Gated spaces show a join
request instead of the feed until staff add the person; members who identify
with the email they joined with can read and post. Joining the same person
twice is a conflict, not a second membership. A moderator (or staff) can hide
or remove a post; hidden posts leave the public feed and stay on the admin
queue. Guest posts are rate-limited, stored as plain text, and land on the
author's contact timeline.

## Voice and video

Admin → Voice and video lists rooms. Start opens a room against a contact;
Join records who entered; Stop captures the recording and transcript onto
that contact's conversation and timeline; Missed call writes the missed-call
timeline event. The vendor SDK stays in the plugin adapter. A title starting
with `fail-` makes the fixture provider refuse; the room or recording stays
`failed` so Retry can run in place. Merge repoints room, join and artifact
`contact_id` columns. There is no WebRTC vendor in core.

## Marketplace channels

Admin → Marketplace channels records a Shopify/Etsy/Amazon/eBay seam, then
handshakes with the plugin adapter. A refused handshake stays `failed` so Retry
can run without creating a second row. Sync currently invoices one hardcoded
fixture order for the buyer contact; it is not a live channel pull.
Credentials are not stored in this fixture adapter; a real provider adapter
replaces it without changing the admin screen.
