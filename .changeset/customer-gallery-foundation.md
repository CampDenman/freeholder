---
"freeholder": patch
"@freeholder/sdk": minor
---

Show customers their active galleries and guest invitations in the portal (C10.29), using a contact-bound query that excludes expired or revoked access. Private gallery images can use gallery-session authorization headers for native clients, without putting credentials in URLs. Explicit invalid credentials cannot fall back to cookies, and image URLs must match the session's gallery.
