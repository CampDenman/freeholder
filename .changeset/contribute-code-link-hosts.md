---
"freeholder": patch
---

A code submission can now link to the forge an instance actually keeps its code on. The code-link field accepted `https://github.com/` addresses and nothing else, so an owner running Freeholder against their own forge could not cite the repository the work was done in. `FREEHOLDER_CODE_LINK_HOSTS` adds hosts to the accepted list; `github.com` stays accepted whether or not anything is configured. The field remains an allowlist rather than becoming an open URL box, because the link arrives from an outside contributor and is shown to a reviewer: links are now checked against a parsed URL, so a plain-text `http://` address, a `javascript:` or `data:` URL, credentials smuggled before an `@`, and a look-alike host such as `github.com.example.test` are each refused explicitly rather than incidentally.
