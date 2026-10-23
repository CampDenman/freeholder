---
"freeholder": patch
---

Freeholder now uses zod 4.6.7, the library that checks every form, API and
MCP input. Earlier versions could run out of memory when someone sent a very
large list to a field that accepts lists, because zod recorded a separate
error for every bad item (GHSA-mrhx-c7xc-m3w5, CVE-2023-54404, high). Update
to this release and redeploy.
