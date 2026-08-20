---
"freeholder": minor
---

Agent work now costs what it costs, and the cap holds. Every managed model turn is priced in whole cents — from published model prices, or the price you set on the connection — and checked against your budget *before* the turn is made, across the agent's period budget, the task's own ceiling and the run. A turn is asked for only as many output tokens as the budget can pay for, a run that cannot afford its next step stops and says so, and an agent with no budget or an unpriced model is stopped before it claims work rather than after it spends. What was actually spent lands in the ledger, `/admin/work/spend` shows it per agent and in total against the cap, and crossing 80% or the cap notifies you once per period.
