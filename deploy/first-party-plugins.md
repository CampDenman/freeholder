# First-party plugins

Gift registries, print-on-demand, community spaces, voice/video and marketplace
channel sync are first-party plugins (MASTER.md §36, C3.13). They install with
the instance; disable one from Admin → Plugins if the business does not use it.

**These are not complete products.** Community, voice/video, print-on-demand
and marketplace channel sync have landed as first-party plugins. POD, voice/video and
marketplace adapters are still test-only fixtures (staged orders, not a live Printify
or channel API). Gift registries already raise ordinary invoices. Outside the test runner, missing live providers now fail explicitly; no print
submission, channel connection or call is reported as successful. Live provider
I/O remains unfinished under C3.13.

## Gift registries

Admin → Gift registries opens a list attached to a contact. Items raise
invoices through the existing invoicing module — there is no second checkout.
The public page `/gifts/<slug>` lets a visitor contribute; that path calls
`contacts.resolve` and `invoicing.createDraft`. A duplicate slug is a conflict.
Retry an item that failed to invoice from the same screen.

## Print on demand

Admin → Print on demand maps a catalog SKU onto a provider product, then
queues jobs. A paid order line whose SKU is mapped opens an ordinary catalog
fulfillment and submits it to the plugin adapter. Provider acceptance marks
the print job submitted; the fulfillment stays pending until shipment evidence
arrives. A vendor order ID is not a carrier tracking number. The
test fixture succeeds unless the SKU starts with `fail-`; production refuses
submission until a live provider is configured. A failed job
stays failed with the provider's message; Retry sends the same job again.
`printOnDemand.submitQueued` retries queued and failed jobs on a schedule.

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

Admin → Voice and video lists rooms. Start opens a room against a contact;
Join records who entered; Stop captures the recording and transcript onto
that contact's conversation and timeline; Missed call writes the missed-call
timeline event. The vendor SDK stays in the plugin adapter. A title starting
with `fail-` makes the test fixture refuse; without a live provider, all
production calls refuse; the room or recording stays
`failed` so Retry can run in place. Merge repoints room, join and artifact
`contact_id` columns. There is no WebRTC vendor in core.

## Marketplace channels

Admin → Marketplace channels records a Shopify/Etsy/Amazon/eBay seam, then
handshakes with the plugin adapter. A refused handshake stays `failed` so Retry
can run without creating a second row. Sync pages provider orders onto
invoices through `contacts.resolve`; the fixture adapter returns the
in-memory list the test staged, not a hardcoded order. Credentials are not
stored in this fixture adapter; a real provider adapter replaces it without
changing the admin screen. `marketplace.retryFailed` retries a failed
handshake or a failed sync in place.

### Sync ownership and retries (C3.13)

Print and voice/video retries exclusively claim existing jobs or artifacts.
Marketplace sync claims an expiring lease, renews it after each page, and
checks its ownership before importing or checkpointing. An expired worker
cannot overwrite a recovered sync. Each imported order resolves its contact,
creates its invoice and records the channel order in one transaction.
Print/call reconciliation after an interrupted vendor request still belongs
to the missing live-provider work; test fixtures do not prove recovery of
real vendor operations.
