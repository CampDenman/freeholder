---
"freeholder-app": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

Redact caller and completion nonces from service audit inputs at every depth,
including nested arrays and mixed-case field names, while preserving audit
identities. MASTER §43 C11.10/C12.38.
