<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Empty original transfer ownership merge scope

C1.12/C11.08/C11.14. Source-only finite repair based on rootf12dff09. Root's
actual clean-checkout CI701 reached ordinary migrations, then three existing
contact merge controls and merchant refund-erasure outbox failed at the
unconditional complete transfer capability gate. That capability intentionally
remains unpublished; it must not be enabled merely to pass unrelated tests.

`transfer-ownership.ts` previously required the full physical protocol before
checking whether either contact had any transfer subject row, and repoint always
issued an UPDATE even for an empty scope. It now takes the same1691709/82
inventory transaction fence and queries EXISTS for exactly both contact UUIDs.
Only an explicit false permits an empty undo capture or skips a zero-work
repoint. Missing tables, failed/incomplete query results or any actual subject
remain fail-closed. The statement does not acquire another owner by equal key,
provider snapshot, current account or raw historical contact text.

Every nonempty original transfer scope still requires the unchanged complete
capability, existing bounded full lineage witness and original guarded pointer
repoint. Undo rechecks the actual exact scope: a newly arrived subject cannot
be ignored as an empty old capture. No physical call, erasure ACK, inventory
capture or capability definition is introduced. Existing immutable first
captures/receipts and all provider/raw evidence stay unchanged. This is a
scoped absence observation of a current ownership relation, not proof of
physical byte absence or stopped writers.

The original three merge and outbox test oracles remain unchanged as the
meaningful actual AFTER targets. No test, compiler, lint, parser, model import,
PG/native/provider or build execution ran in this source lane. Root owns actual
qualification. In particular, erasure first-scope capture's inactive protocol
gate is a separate obligation and is not bypassed here. Full media producers,
all pending source/business/provider/security/stable gates remain required;
no C checkbox closes.
