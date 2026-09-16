---
"freeholder": minor
---

Groundwork for the customer mobile app: your instance now publishes
`/.well-known/freeholder`, so an app can be pointed at your web address and
pick up your name, branding, currency and timezone — and tell a customer to
update their app rather than showing them a broken screen when it is too old.
The app package itself holds only what a phone needs: how to find you, how to
hold a session in the keychain, and what to show with no signal.
