---
"freeholder": patch
---

The public playground recipe now stays out of production's way when both run on one server. The demo gives way on CPU and memory, restarts by itself after running out of memory, and its hourly reset brings up the fresh demo before retiring the old one, so visitors see a brief pause instead of a minute of errors. Its proxy compresses pages, queues bursts and shows a short "try again in a minute" note if the demo is unavailable. Anonymous visits to the demo's sample pages carry no cookies and can be cached briefly by a CDN placed in front of it.

Self-hosters on a small server can set `FREEHOLDER_JOBS_POLL_SECONDS` to make background workers check for new work less often (the default stays two seconds), which cuts idle database activity.
