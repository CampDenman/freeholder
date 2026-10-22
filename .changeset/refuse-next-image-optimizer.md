---
"freeholder": patch
---

Next.js's built-in image optimizer is switched off, so `/_next/image` now answers "not found". Freeholder never used it (pictures are prepared by its own media service), and turning it off removes the part of Next.js that the critical advisory GHSA-2464-fhr4-w9xw (published 22 October 2026) affected, on every kind of hosting.
