---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
Keep actual provider caller mutation audits limited to original call/read IDs
and observation ordinals. Process-held callback nonces remain outside audit
inputs while immutable original money observations retain their own records.
