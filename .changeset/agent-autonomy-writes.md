---
"freeholder": minor
---

Managed agent writes now honour the autonomy ladder. Suggest produces a proposal and never escalates, approve parks a previewed change, autonomous executes ordinary writes, and irreversible actions always wait for a person. Classification is declared on each service definition and fails closed: a mutation that never declared one queues for approval whatever the agent's autonomy. The gate refuses paused agents and paused connections, refuses proposals outside the agent's own scopes, and stores approved input verbatim while redacting every read of it. Previews cover block diffs, messages, money and destructive work.
