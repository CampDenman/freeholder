---
"freeholder": patch
---

Analytics consent reconciliation now recognizes the instance's configured
public origin when Freeholder runs behind a loopback reverse proxy. Cross-site
origins remain refused, while the browser no longer receives a false 403 on an
ordinary page load through nginx or Caddy.
