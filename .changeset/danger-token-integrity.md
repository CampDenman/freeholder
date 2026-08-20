---
"freeholder": patch
---

Danger buttons and the unread badge now take their text colour from a new `onDanger` token instead of a literal white, which failed WCAG AA on the dark scheme's lightened danger fill. The token contrast test enforces the pairing in both schemes. Shadows join the token set too: the pressed button edge, the hero emphasis and the floating chat launcher are `shadow-press` / `shadow-raised` / `shadow-float` tokens defined once in tokens.ts, replacing nine hand-written copies.
