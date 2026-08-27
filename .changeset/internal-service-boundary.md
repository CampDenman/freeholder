---
"freeholder": patch
---

Keep scheduler, briefing-contributor, provider-webhook, notification, and
lifecycle-maintenance services inside the platform. They can still compose
through the audited service registry, but anonymous callers and API keys now
see the same 404 as an unknown service, and the operations no longer appear in
OpenAPI, SDK/LLM projections, API-key scope choices, or MCP discovery.
