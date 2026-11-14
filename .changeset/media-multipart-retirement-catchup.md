---
"freeholder": patch
---

C1.12/C11.08: queue the exact original idle-upload retirement proof in its own
retirement transaction, so an interrupted owner continuation can be completed
by the genuine worker without another storage request. Changed evidence or a
hold still requires review before an old certificate can be reused. Full media
protocol availability and evidence minimization remain gated.
