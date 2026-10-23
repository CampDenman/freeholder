---
"freeholder": patch
---

C6.11: Event registration and event pages are fixed. Pressing "Register and pay"
twice no longer tells the visitor their registration failed while their seat
and invoice were already held: repeating the same submit from the same form now takes
them to the same invoice, and never creates a second one. Someone else who
enters the same email gets the same message as any refused registration and
never sees the invoice. Event pages no
longer show the builder's placeholder text, a "Get in touch" button or other
landing-page blocks; they show the event's title and details. Session times
read in the event's own time zone and the visitor's language (for example
"Sun, Nov 8, 4:00 – 6:00 PM PST"), and seats read "3 of 8 seats left". The
events list only links to events whose page is live, and finished events move
to a "Past events" section with their pages still viewable. Existing event
pages pick up the new layout the next time you save the event.
