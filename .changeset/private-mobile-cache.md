---
"freeholder": patch
"@freeholder/mobile-app": minor
---

Persist native customer read snapshots as bounded AES-GCM ciphertext with a session-specific key in the platform keychain (C10.30). Private snapshots expire after 60 seconds, disappear on expiry/background, and revalidate on foreground. Permission denials evict cached data; sign-out and account changes prevent late requests from restoring it. Offline restart can restore remembered public branding without extending private access. Cache failures preserve successful live reads and never fall back to plaintext. Native proofing/image caching remains C10.27; physical device validation remains open.
