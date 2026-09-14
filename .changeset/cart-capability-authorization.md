---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C5.20/C5.23/C8.08/C11.10: Require the matching cart token, verified contact ownership or authorized catalog scope for cart reads and edits. Saved carts and private wishlists no longer accept anonymous contact IDs. View-only cart reads redact write tokens, and admin displays use cart IDs. Guest cart and gallery-purchase integrations must pass cartToken; getCart retains its token input. Preserve checked checkout composition and exact API scopes, and refuse editing closed carts.
