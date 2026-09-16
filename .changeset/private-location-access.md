---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C11.10 / §4.10: Restrict hidden location addresses, hours and service areas to authorized location readers. Public ID/slug reads return no hidden location, and includeHidden requires location read permission. POS and social staff without location access retain visible location choices.

Generated location pages and sitemap metadata stop exposing hidden addresses immediately, including before the location event is delivered. The listener then unpublishes the generated page while retaining its content.
