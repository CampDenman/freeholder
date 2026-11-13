---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

Keep original import erasure pending when deletion of private upload chunks still leaves an unaccepted normalized index requiring recovery (C1.08/C3.47/C11.14). Completion checks the original queued task, verified receipt, current retention membership and locked import in one transaction before acknowledging that task. This containment does not remove immutable normalized metadata or repair historical completed receipts.
