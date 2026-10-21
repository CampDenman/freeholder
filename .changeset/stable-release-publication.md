---
"@freeholder/cli": patch
"@freeholder/sdk": patch
"create-freeholder": patch
---

Preserve build-declared compatibility and recovery instructions in signed releases.
Keep release candidates off stable/latest tags, require completed owner acceptance
before stable publication, and publish all six v1 package artifacts after exact main CI.
Skip IndexNow delivery in the isolated public playground instead of filling its failed-job queue.
