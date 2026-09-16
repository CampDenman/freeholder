---
"freeholder": minor
---

Require durable current-version worker heartbeats for readiness, separate the
process liveness probe, expose payload-free queue lag and degraded state, and
make Doctor verify the live worker rather than the in-memory job registry.
Retry dependency-bound startup without sacrificing process liveness, and keep
the Node bootstrap outside Next's Edge instrumentation dependency graph.
