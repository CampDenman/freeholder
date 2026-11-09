---
"freeholder": patch
---

Add a durable deployment admission hold shared by member/group call starts and
the background runtime. Existing calls can continue and end while a qualified
host waits for accepted work to drain; unknown work prevents cutover.
