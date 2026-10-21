---
"freeholder": patch
"@freeholder/mobile-app": minor
"@freeholder/sdk": minor
---

Add native invoice list/detail screens with an invoice-specific browser handoff and a return link to the app (C10.26). The app never calls payment services or puts a user session in a URL. Browser capabilities are live reads restricted to the invoice's customer and are retired when payment closes the invoice.

Exclude Git metadata, agent/workspace folders, mobile sources and test output from standalone server artifacts. The artifact gate now rejects or scrubs these roots without changing its size limits.
