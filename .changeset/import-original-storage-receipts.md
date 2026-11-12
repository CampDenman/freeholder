---
"freeholder": patch
---

Bind private source uploads to their original storage resource and record raw
chunk writes in the shared physical operation ledger. Cleanup and reader-source
erasure now verify that original resource before deleting bytes. Source reads
also require the accepted original physical receipt, even if a replacement
resource contains identical bytes at the same key. Legacy unverified storage
requires fresh human recovery evidence; unknown writes remain pending.
