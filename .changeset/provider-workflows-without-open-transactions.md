---
"freeholder": patch
---

Connecting Gmail, Outlook, calendars, social profiles, and signup contact
imports no longer ties up a database connection while an outside provider is
responding. This removes a pool-exhaustion failure mode without changing any
public service name or callback.

OAuth state is still single-use: Freeholder commits the claim before spending
the provider code, validates identity and permissions outside the transaction,
then atomically stores credentials. Signup contact selections also recheck the
current account, owner policy, and import limit immediately before staging.
The private phases stay caller-authorized and audited while remaining hidden
from HTTP, OpenAPI, and MCP.
