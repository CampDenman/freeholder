---
"freeholder": patch
---

OAuth callbacks and signup contact imports no longer keep a database
transaction open while waiting for Google, Microsoft, or a social network.
Freeholder now commits the one-time OAuth state first, performs the provider
exchange and identity lookup outside every transaction, and atomically stores
the validated credentials afterwards. Contact-list reads and selections use
the same short source/apply phases, including a final policy and account check
before any selected contacts are staged.

The public service names and callback behaviour are unchanged. Internal phases
remain caller-authorized and audited but are not exposed through HTTP, OpenAPI,
or MCP, and the orchestration contract refuses nested transactional calls.
