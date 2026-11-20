---
"freeholder": patch
---

Patch Next.js to 16.4.6, clearing two moderate advisories (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8) that the live dependency audit had started failing on. Both are fixed from 16.4.5; the declared range moves from `~16.4.2` to `~16.4.6` so a fresh resolve cannot fall back to an affected patch.
