---
"freeholder-app": patch
---

<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

Give production builds the same 8 GiB JavaScript heap allowance as the existing
lint and typecheck commands so Next.js can finish its TypeScript worker on the
full application. Keep production type checking enabled. MASTER §43 C11.17.
