---
"freeholder": patch
---

Control borders now meet WCAG 1.4.11. The `rule` token was 1.17:1 against every
background it borders, so the edges of inputs, selects and textareas were
effectively invisible to low-vision users, in the default palette as well as in
custom ones. Raising `rule` itself was not the fix: it draws 828 hairlines across
the product and only 60 of them are controls, so every divider would have gone
dark to correct the fields. There is now a separate `ruleStrong` role, checked
for 3:1 on every ground a control sits on, and 322 control borders use it.
Dividers keep the lighter `rule`, which is correct — 1.4.11 governs the edge of
something you can operate, not decoration. Reported by a third party.
