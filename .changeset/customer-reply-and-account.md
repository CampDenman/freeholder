---
"freeholder": patch
"@freeholder/mobile-app": minor
"@freeholder/sdk": minor
---

Add a customer reply into the caller's own thread, a portal/app thread view, newsletters and account screens, and native TOTP/recovery two-factor sign-in (C10.28). `conversations.replyAsContact` never sends on the business reply channel and is rate-limited per contact. Sign-out revokes a held device token. WebAuthn-only accounts still sign in on the website.
