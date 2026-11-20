<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Exact finished-cohort transfer executor recovery — source only

This finite C1.12/C11.08 dependency follows frozen34919289 and preserves all
prior source/oracles. No compiler, lint, test, parser, model import, database,
migration, provider/account or host operation ran. Both complete-request and
multipart part capabilities remain unpublished. No platform/stop/provider or
full-spec acceptance is claimed.

The current controlling-ancestry fix intentionally refuses a later drain even
when an older caller genuinely belongs to a transfer. Rebinding the original
plan's `sourceDrainId` or bypassing the controller would reopen cross-plan and
late-writer authority. This slice supplies a narrower real continuation: an
operator may capture a distinct recovery association for the exact current
plan before stopping its executor. It can release only when every original
physical mutation and its logical caller actually finished. Truly unfinished
or stopped-applied target callers remain debt; their stronger original nonce/
full-byte/complete-inventory review is a prerequisite to a later continuation.

The existing root-only Linux operator script accepts optional `--plan-id` at
capture. Under the exclusive namespace inventory fence it first creates the
durable capturing drain and reads the complete bounded plan/object/caller/
physical-request/receipt cohort. It records only original UUIDs, runtime birth,
manifest and descriptor/token/key digests and immutable creation instants;
raw object keys, contact data and provider credentials are not copied into the
process witness. The actual unit/cgroup/process snapshot then includes a
versioned `freeholder.media-transfer-drain/v1` recovery association. SQL
independently rereads that exact complete inventory when it seals capture.
Another plan, subset, changed cohort, wrong namespace or later association
fails. The original plan's first source drain/digest never changes.

Actual process capture and stop verification remain the existing real host
operations. Timeout, readiness, empty provider lists and this metadata
association do not supply a process stop. An association cannot grant provider
mutation while the drain is active: all existing TS and SQL namespace controls
remain unchanged. Fresh GET recovery remains distinct. At release the operator
must explicitly select the captured plan again. Under the same exclusive fence,
both CLI structural checks and independent SQL require the exact first cohort,
authentic verified stop, every actual logical and physical mutation return,
no unknown/legacy birth or active multipart session, and no competing current
namespace controller. The first stop witness and every return remain unchanged.
A changed original physical admission or new writer is not silently adopted.
Only the actual existing operator release transition removes this additional
fence; normal plan phases, source ownership, holds and physical proof gates
still govern any later operation.

The source inspection also found a pre-enable state-machine gap: the old drain
trigger constrained verified/released rows, but did not explicitly forbid a
captured row jumping to released or a released birth. The trigger now requires
a new drain to be born capturing with no stop/release facts, and permits only
capturing → captured → verified → released transitions. Stop/release timestamps
cannot be preseeded or substituted. This is conditional source exposure, not an
observed production incident. Existing capture-only negative fixtures remain
capture-only and cannot become authentic kernel evidence.

No model, column, index, trigger, public service/SDK input or journal changes.
Two new read-only SQL proof functions are prepared:
`freeholder_media_transfer_recovery_snapshot(uuid,text)` and
`freeholder_media_transfer_recovery_drain_releasable(uuid)`.
The existing drain evidence guard consumes them. Ordinary stop proof accepts
the optional structurally versioned association without treating it as any
extra ordinary caller-finish or provider-outcome authority. Portable fully
tracked cohorts keep their existing path and do not acquire a global Linux
requirement.

Ten structural pure controls are PREPARED/UNRUN: exact unchanged first cohort,
JSON key ordering, explicit original plan selection, namespace/plan mismatch,
later caller/request/receipt, subset inventory, altered runtime/descriptor,
source-drain rebinding, malformed/empty membership and bounds. They compare
fictional structures and supply neither actual stop nor database proof. Four
native negative controls are PREPARED/UNRUN through genuine shared services and
fictional private TCP: capture-only cannot release; a subset cannot seal; no
captured/verified/released birth is accepted; a real pre-admitted target PUT
remains fenced despite a matching association. These tests never seed a
verified stop, fabricate ServiceContext, mock authorization or publish a flag.

## Actual operator acceptance still required

Use a disposable owned Linux/systemd environment after the complete protocol
and fresh ordinary schema/source gates qualify. Never substitute synthetic
process rows for this proof. The operator retains database credentials privately
and runs the real host commands; the agent does not perform host/account steps
under this source-only task.

1. Through the actual shared services and configured private fictional test
   provider, create a source object and an immutable transfer plan. Run a target
   create-only PUT through actual server-held logical/physical callers; allow
   both real returns to commit, then stop advancement before canonical copy
   settlement. Preserve source bytes, target bytes, original plan, caller,
   requests/facts and first return evidence independently.
2. On that actual original host, run the existing operator capture with its
   exact namespace, source revision and `--plan-id`. Preserve the real returned
   drain UUID and its complete first cohort. The operator personally stops the
   actual unit, then runs verify. Confirm original boot/PID/start generation,
   captured cgroup, all original processes absent and verified stop digest.
   A typed revision string alone is not proof of the deployed binary.
3. Prove a new ordinary or transfer mutation still refuses while this matching
   additional drain remains verified; a GET must not acquire mutation privilege.
   The operator releases using the exact captured plan. Independently prove the
   original plan sourceDrainId/sourceStopEvidenceDigest, captured process/cohort
   JSON and every first return are unchanged, with only the separate release
   fact added.
4. Resume via the existing shared transfer path. Verify its actual fresh source
   and target full-byte checks, complete inventories, atomic exact-key adoption
   and conditional source retirement, with no extra target PUT. Preserve the
   original copied-resource privacy lineage and all quota/hold proof. This
   future whole journey remains dependent on the other complete protocol gates.
5. Separately repeat controls with an unfinished logical or physical caller,
   unknown first result, active multipart session/part authority, NULL legacy
   birth, wrong boot/process generation, new/mismatched admission, changed
   plan/controller and late positive observation. Every case must retain debt,
   original receipts and bytes, and refuse release or subsequent mutation.
   Preserve the first failure without resetting its database. Capture actual
   journal/source hashes, profile and closed-client proof after each case.

Real provider/platform acceptance remains separate from this fictional provider
operator journey. Unknown remote legacy executors are explicit debt; a local
systemd witness cannot assert that an unrelated remote host or already issued
browser part authority stopped.

Still required: exact stopped-applied target PUT original-nonce/read/inventory
consumer and physical-row settlement before its drain can release; unknown
DELETE provider-terminal proof; full multipart/part/session lifecycle; quota
initialization/release recovery; cutover; source/schema/native qualification and
actual provider/platform acceptance. This bounded actual-finish continuation
closes none of those requirements and does not publish capabilities or stable.
