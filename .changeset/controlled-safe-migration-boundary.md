---
"freeholder": patch
---

Startup, test setup and the manual migration command share the same dedicated
PostgreSQL session and migration lock. The forthcoming safe-response migration
requires a committed earlier prefix and its own official migration transaction.
Its final source hashes remain unset until reviewed assembly, so it refuses
activation rather than assuming the boundary is ready. Packaging and real
PostgreSQL qualification remain required before rollout.
