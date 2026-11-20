---
"freeholder": patch
---
Private previews no longer treat an arbitrary Authorization header as access to public API routes. Versioned API and MCP callers must resolve a genuine credential or hold the signed preview cookie; anonymous routes remain closed.
