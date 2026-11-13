---
"freeholder-app": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

Preserve legitimate null service results over HTTP so API and generated SDK
callers receive the same absence result as the shared service, including
unpublished pages and hidden locations. Routes that omit a response body still return their usual
acknowledgement. MASTER §43 C3.03/C3.22/C3.47.
