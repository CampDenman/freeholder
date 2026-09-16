---
"freeholder": minor
---

Automations run. A rule can wait days between steps, branch on what actually happened, repeat a fixed number of times, hold for your approval, and stop — and you can watch every step it took, kill one mid-flight, or see why one stopped.

A waiting automation is a row rather than a running process, so a two-day delay survives a deploy, a restart or a crash. The same event arriving twice runs the automation once. A rule set to run once per person runs once per person, and a cooldown holds somebody back until it has passed.

A run remembers which version of the automation it was following, so editing the rule tomorrow never changes what yesterday's run was doing.
