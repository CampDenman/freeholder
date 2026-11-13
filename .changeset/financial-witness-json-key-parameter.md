---
"freeholder-app": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

Give financial-history JSON keys an explicit PostgreSQL text type so receipt-only
subscription history can be inspected even with empty agreement-fee tables.
Preserve the original parent identities, full row hashes and refusal rules.
MASTER §43 C12.38/C11.14.
