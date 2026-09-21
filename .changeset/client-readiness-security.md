---
"freeholder": patch
---

Require a deployment secret for first ownership in production, remove private data from public waitlist acknowledgements, authorize referral attribution, and serialize loyalty redemption and event capacity changes. Isolate magic-link and form rate limits so one visitor cannot exhaust a shared site-wide bucket.

Reject invalid event tickets and disable unpaid paid-ticket enrollment. Disable automatic updates and rollback until verified host execution and recoverable backups exist; previous snapshot fingerprints were not backups. Honor the self-host image override and require rollback image pins. See deploy/client-readiness.md for setup and deployment requirements (C1.03, C1.05, C6.08, C6.11, C9.09, C9.12, C10.05, C10.06, C10.10, C11.10).
