---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C7.03/C11.10: Protect private notes when pinning and reading revision history. Colleagues cannot pin or receive another author's private note, and API-key history reads follow the same visibility rules as note lists. Editing and removal lock the authorized row so a concurrent privacy change cannot invalidate their checks.
