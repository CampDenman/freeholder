---
"freeholder": patch
---

Fixed the DigitalOcean droplet recipe never being able to serve HTTPS: the
Caddy container was not given the domain name, so it failed to start and the
site stayed unreachable even with DNS pointed correctly.
