---
"freeholder": minor
---

`freeholder update` now exists as a command. Check, preflight, apply or roll
back an instance from a terminal — or from cron, which is what the exit codes
are for: 0 up to date, 1 an update is waiting, 2 a security release is
outstanding, 3 the instance could not be reached. Those last two are separate
so a monitor can page on "you are exposed" without also paging every time a
feature release ships.
