---
"freeholder": patch
---

Keep import source-file cleanup recoverable after a storage outage or a lost
upload acknowledgement. Private source chunks now enter the shared pending
object ledger before provider writes. Expiry, replacement and parsing schedule
durable cleanup; immediate deletion remains a fast path. The existing orphan
sweep can retry exact source keys after their upload window expires. Source
uploads refuse public object storage. This supports C3.22/C2.29/C11.10 without
claiming live provider acceptance or independent security sign-off.

Bind each private chunk to server-computed immutable bytes before storage. An
identical received retry performs no extra provider write; a changed retry or
corrupted stored chunk is refused. A verified retained-source descriptor keeps
an active archive's original chunks safe from scheduled deletion and the orphan
sweep until release or expiry. Source reads verify ownership, size and digest
outside the service transaction; preview acceptance checks expiry again.

A provider write completing after the original reservation was swept now commits
a fresh cleanup witness on both success and ambiguous error before expired
uploads are refused. The follow-up closes a peer-reproduced late-write gap.

An erasure-refused WXR releases only that rejected raw upload through a typed,
private, original-parent phase. Ownership removal and cleanup commit together
before the refusal is returned, preserving existing immediate byte removal
without releasing active archives or unrelated retry state.

A rejected PUT promise now retains its exact attempt as unknown instead of
inferring provider cancellation. Only an acknowledged successful write clears
its own witness. Late writes after a client-side error remain discoverable;
cleanup and erasure must wait for actual provider outcome evidence.
