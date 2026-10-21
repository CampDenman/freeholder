---
"freeholder": patch
---

C10.10: The DigitalOcean droplet deploy now stages its complete remote script before backup runs, so a command reading stdin cannot silently skip the image swap while reporting success.
