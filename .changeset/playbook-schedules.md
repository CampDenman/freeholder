---
"freeholder": minor
---

Playbooks can run on a schedule now. Write "0 7 * * 1-5" against a playbook and
it runs every weekday at seven — in your business's timezone, so it stays seven
in the morning when the clocks change rather than drifting to six or eight for
half the year.

Two things it deliberately will not do:

It will not flood you after an outage. If the instance was down for six hours,
a five-minute playbook comes back with one overdue run, not seventy-two. You
can also say that a window missed while nothing was running should simply be
skipped — a briefing delivered seven hours late is not a briefing.

It will not stack runs on top of each other. If the last run is still going, or
still waiting for you to approve something, the next window is skipped and the
playbook tells you what is holding it up.

Each scheduled playbook shows when it runs next and what happened last time.
