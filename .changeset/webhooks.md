---
"freeholder": minor
---

Your site can now tell other systems when something happens. Add a webhook
under Settings, choose which events matter — everything, or a group like
`contact.*` — and Freeholder posts each one to the address you give it.

Every message is signed, so the receiving system can prove it really came from
your site and not from someone pretending. If their server is down, Freeholder
keeps trying on a widening schedule for about six hours before giving up on
that message, and pauses the webhook entirely if it has been unreachable for a
long run — with the reason written on screen, and a button to turn it back on.

You can see every attempt: what was sent, what came back, and what went wrong.
There is a "send a test" button so you can check the whole path works before
you rely on it.

Webhook addresses have to be public https addresses. Freeholder refuses to
send your events to an address on its own server's private network, which is
the mistake that turns a webhook into a way for someone to read things they
should not.
