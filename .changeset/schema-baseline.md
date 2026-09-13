---
"freeholder": minor
---

The database schema is now one reviewed baseline instead of a chain of 168
migrations. A brand-new install still migrates from empty, and seed, demo and
restore still work. This is a one-time break of the N-1 upgrade gate: an
instance whose journal still names the old chain cannot apply this file, and
rolling back to a pre-collapse image is not a safe image swap. That is
expected, labelled `schemaRisk: "breaking"`, and is why this lands before 1.0.
First-party plugin migrations numbered 0168 are not in this baseline and must
be folded in when those PRs land.
