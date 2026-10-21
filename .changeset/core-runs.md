---
"freeholder": minor
---

**Schema-breaking.** Runs, steps, approvals and spend move out of the agent layer into their own home, and the tables are renamed to match: `agent_runs` becomes `runs`, `agent_steps` becomes `run_steps`, `agent_approvals` becomes `run_approvals`, `agent_spend` becomes `run_spend`. A release older than this one will not find the tables it expects.

Nothing an owner can see changes. This is groundwork for automations, which need to record a run the same way agents do — so that an automation mixing a written instruction with an automatic action produces one history you can read, rather than two.
