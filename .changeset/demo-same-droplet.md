---
"freeholder": patch
---

The disposable playground can now share the project's DigitalOcean host without
sharing the production database or application network. An optional Compose
overlay keeps only Caddy attached to the playground proxy network across
deployments, and the checked-in demo Caddy site documents the public route.
The playground entry now sets its translated document title for browser tabs and
screen readers.
An hourly reset now waits for the playground entry page as well as health
readiness before reporting recovery.
