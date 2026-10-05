---
"@freeholder/sdk": patch
---

Parse imported HTML with the browser-compatible parser and the CMS allowlist,
including malformed markup and numeric character references. Accessibility smoke
checks now run only their own axe code, never page scripts. Recovery passwords
are saved to a private file rather than printed into terminal logs or captured output.
