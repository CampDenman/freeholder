---
"freeholder": patch
---

The DigitalOcean droplet recipe now serves `www` over HTTPS and redirects it to
the primary domain while preserving the path and query string. The setup guide
includes the required `www` DNS record.
