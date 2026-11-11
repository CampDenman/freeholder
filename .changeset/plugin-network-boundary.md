---
"freeholder": patch
---

Plugin provider requests and recording downloads now use a transport bound to their manifest's network:external permission. The shared transport checks every DNS answer, pins the connection, refuses redirects and private addresses, and bounds request bodies, response bytes, timeouts and cancellation. The Plugins screen identifies declared network access. In-process plugin code still requires trusted source; this is not a JavaScript sandbox (C3.41).
