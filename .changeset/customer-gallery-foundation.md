---
"freeholder": patch
"@freeholder/sdk": minor
---

Show customers their active galleries and guest invitations in the portal (C10.29), using a contact-bound query that excludes expired or revoked access. Portal rooms now have translated document titles for accessible navigation. Private gallery images can use gallery-session authorization headers for native clients, without putting credentials in URLs. Explicit invalid credentials cannot fall back to cookies, and image URLs must match the session's gallery.

Fix the contract-evidence gate on Windows when the test runner and workspace use different path casing (C11.15). Each required file must still contain a passing test, and different directories cannot substitute for one another.
