---
"freeholder": patch
---

The opt-in Docker host updater for the standard app/db/caddy recipe is now fully drill-tested end to end: the shipped `deploy/docker-selfhost/docker-updater/compose.yml` and `Caddyfile` give operators the exact recipe the executor inventories, and the refusal paths — wrong recipe shape, published app port, local media, mutable tags, missing signature identity, interrupted runs — each carry a host test proving the executor refuses instead of reporting success (C10.31).
