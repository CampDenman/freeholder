---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

Require exact original controlled-target recovery before another ordinary
payment path can collect the same accepted subscription invoice. Acquire the
original resource and subscription locks before canonical payment locks, while
keeping already retained bank-cash application separate from new collection.
