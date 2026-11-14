<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Finished acknowledged DELETE recovery — source only

This finite dependency follows frozen18187b82. No compiler, lint, parser,
database, native, provider/account or deployment action was run. It does not
enable the complete request capability or close C1.12/C11.08. It is separate
from the urgent protected-main part-signing containment.

An actual provider DELETE can acknowledge success and its physical request can
finish, while retaining the later local successful result fails. The genuine
owning closure then retains a first failure, actual caller finish and immutable
provider ACK. Replaying that DELETE is unsafe and unnecessary; declaring the
original bytes gone without further physical proof is also unsafe.

The existing ordinary cleanup path now permits fresh verification only for
this narrow case: unknown first-failure state, exact failed-result digest,
NULL prior stop/review, actual logical and physical return timestamps, matching
original physical runtime and immutable descriptor, exactly one conditional
DELETE and an actual successful 2xx acceptance observation. It does not turn a
failed/absent response, timeout, unreturned writer, another runtime or a prior
reviewed late caller into this case. Unknown requests lacking a successful ACK
remain debt and cannot acquire a new DELETE.

The producer sends no second DELETE. It reuses the existing fresh pinned
absence and complete agreeing physical version/session inventories under the
exact original UUID. Holds, ownership, namespace, original generation and all
other copies remain checked through the existing shared rules. Only after this
proof does the shared final transaction append a separate `retired` review,
referencing the exact first caller witness, immutable physical request/fact
digests, actual absence read and complete inventory. The original failure,
returned timestamp, token, ACK and original writer finish remain unchanged.
The reviewed state is distinct from a fabricated successful first return.

SQL independently requires the actual successful ACK, real finishes, original
conditional revision, fresh actual pinned absence, complete physical inventory
and exact receipt lineage before accepting the system recovery review. The
ordinary complete-retirement predicate consumes only that exact review. Quota
release and receipt retirement remain in the same final transaction; later
local refusal cannot roll back the earlier physical facts or cause replay.

No model, column, index, trigger, journal or public signature is added. Existing
review-context and ordinary-retirement function bodies are strengthened. The
full capability remains unpublished.

Seven pure controls and one native regression are prepared/unrun. Pure cases
cover the narrow verification-only result, missing actual finishes, invalid
ACK status, foreign runtime, prior stop/review, arbitrary failure/missing
acceptance and multiple actual dispatches. All prior pure/native bodies remain
unchanged.

The native case uses the real shared provider path and a fictional private TCP
store. A narrowly named new test-only database trigger rejects only local
successful DELETE-result retention after its real provider ACK/physical finish
have committed. It replaces no product guard. The actual closure records its
first failed return/finish; recovery must then retain that first failure and
append a separate actual physical proof with exactly one total DELETE. The
trigger/function are removed in `finally`; all original product guard bodies,
original physical descriptor/facts and actual return fields are asserted
unchanged. It never mocks authorization, fabricates a ServiceContext or enables
a fixture capability. Its native setup requires the actual complete protocol,
so this prepared case supplies no acceptance before that protocol qualifies.

Still required: provider-terminal recovery for unknown DELETEs without an
actual successful ACK; stopped-applied PUT consumption for later retirement;
additional crashed-transfer executor association/release; full per-part/session
provenance and retirement; quota initialization/release recovery; cutover;
source/native/fresh-schema qualification and actual platform/provider/account
acceptance. No current-key absence or expiry alone can close those gaps.
