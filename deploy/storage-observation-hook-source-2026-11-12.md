<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Storage observation domain boundary — 2026-11-12

C1.12/C3.47/C11.08 infrastructure source; completion stays open.
`observeStorageOperation` commits its original row/positive acknowledgement
before invoking named domain reconcilers. Callbacks receive only the receipt
UUID, use their own original membership and actual shared SYSTEM service,
and must admit their own durable retry plus periodic recovery for crash/old
image gaps. Executor identity grants no reader erasure authority.

Callbacks run sequentially in stable name order; another callback still runs
if one fails. Caller errors contain a generic pending-recovery message rather
than the dependent domain's private error. A callback failure cannot roll
back the completed physical-fact transaction or establish absence. Existing
media-scope reconciliation remains separate. No new domain is registered by
this infrastructure checkpoint; direct multipart/finalization paths still
need an explicit after-commit notification where applicable.

Full Node22 types and focused lint pass. Four hook controls pass alongside
the existing storage tests. A native normal79 PostgreSQL control explicitly
seeds a prior dispatch intent, then records its positive observation. The
callback reads accepted/positive-at through a separate pool query before
throwing. The observation remains intact; a later negative observation does
not erase it. This is phase-commit evidence, not a real provider receipt.
Report `/tmp/freeholder-storage-observation-hook-native.json`:1/1 PASS4246ms.
An independent backend check returned no active sessions.

Full domain registration, erasure/cross-storage lifecycle, contiguous schema,
provider and final-candidate acceptance remain required. No checkbox closes.
