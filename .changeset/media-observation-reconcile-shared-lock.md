---
"freeholder": patch
---

Parallel media writes no longer fail because a committed-observation reconciler
overlaps (§43 C1.12/C11.08). Each committed storage receipt runs the registered
domain reconcilers inline, and three of them took the contact-identity lock in
EXCLUSIVE mode, so two members uploading at the same moment could see
"Another contact merge or privacy request is in progress" purely because one
upload's own receipt had triggered a reconciler. Those reconcilers only follow
facts that already committed and admit idempotent retry work — they never
minimize, retire or repoint a contact — so they now take the shared waiting
mode, which still keeps them outside a merge/erasure cutover. Exclusive worker
minimization and the interactive fail-fast behaviour are unchanged.
