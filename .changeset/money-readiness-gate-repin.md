---
"freeholder": patch
---

Fixes a defect introduced hours earlier in this same release: the change that gave the cash-application scope a stable order also switched off an internal readiness check that guards the atomic credit-fee path, because that check verifies the exact contents of the function that was rewritten. Nothing failed visibly — the affected paths simply refused, and two of them returned nothing at all rather than reporting a problem, which on a live site would have meant credit-fee work quietly declining to run. The readiness check is updated in the same migration that rewrote the function, the migration now refuses to apply unless the check passes afterwards, and a new test asserts every one of these readiness checks against a real migrated database, which is the assertion whose absence let this through.
