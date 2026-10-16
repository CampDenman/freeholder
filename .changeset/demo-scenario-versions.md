---
"freeholder": patch
---
Fixes a site upgrade that could start without its background jobs: two demo scenarios changed without a new version, so an existing site refused them at startup. They are now version 2, and the build now fails whenever a stored onboarding definition changes without a version increase.
