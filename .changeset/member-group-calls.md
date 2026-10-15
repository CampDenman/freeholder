---
"freeholder": minor
---
Members can now hold group voice and video calls in their encrypted group conversations, through the site's own media server (LiveKit). Calls are end-to-end encrypted: the caller's device makes the call's key and sends it only to the devices in the conversation, so the media server forwards audio and video it cannot decrypt. Everyone who has accepted the conversation is rung and can join; people whose request is still waiting are not. Nothing is recorded. Site owners turn group calls on by setting `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
