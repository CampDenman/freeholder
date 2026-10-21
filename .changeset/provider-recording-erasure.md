---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C1.08/C3.13: Keep privacy erasure in progress until durable provider cleanup jobs succeed. Daily cleanup verifies the original room/domain, closes the call, removes recordings and transcripts and checks the resulting inventory. Local deletion commits its retry task in the same transaction. Retention holds protect cascading parent rows; pending receipts survive cleanup and cannot be silently cancelled, denied or overwritten. The privacy request screen explains pending work in English, French and Spanish and links authorized staff to background jobs.
