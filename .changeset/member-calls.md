---
"freeholder": minor
---
Members can now call each other. Voice call and Video call buttons on a profile ring the other member, who sees an incoming-call bar on any page of the site and can answer or decline. Calls are peer to peer: audio and video travel directly between the two devices, encrypted by WebRTC, and the site only passes the short messages needed to connect them, deleting each as soon as it is read. Nothing is recorded. Only people you follow, your friends, or someone whose message request you accepted can call you, and a call nobody answers becomes a missed-call notification. Sites that run their own TURN relay (for example coturn) set `TURN_URLS` and `TURN_SECRET` so calls also work across strict networks; nothing defaults to a third-party server.
