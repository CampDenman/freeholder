<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original form lead copies

C3.34 is still open until actual Paradise Modern acceptance. The independent
switch remains off by default. This repair does not assert a provider-wide
idempotency or erasure API that has not been accepted in the original account.

The page and booking intake render the same translated notice and an opaque,
form/site-bound receipt of its original account. Submission commits a frozen
request and destination only when that receipt and the site-form seal validate.
Screening by itself never authorizes a lead copy. Enabling a sink later cannot
add permission to an older enquiry. Notice expiry limits new authorization;
it is never evidence that an already started provider operation did not happen.

The worker records a physical intent before each POST. It verifies the exact
original account, reads the frozen body, and releases the transaction before
network I/O. A positive reply must identify an accepted lead. A network loss,
server error, invalid reply or uncertain apply leaves an unknown witness and
blocks another POST. Outbox delivery can retry and dead-letter for review while
that physical caller remains blocked. An explicit HTTP rate-limit refusal can
admit the next attempt with the same original request; permanent client
refusals are retained and logged without visitor answers. External IDs alone
are not assumed to provide provider-side deduplication.

Open **Forms → Original lead copies** using a freshly verified person with
forms management access. Identify the original provider account and physical
request, obtain its final provider outcome, and prove the original caller and
all pending remote work have stopped. Record those independent facts. Human
proof stays distinct from observed HTTP replies and every prior human review
remains in the witness. A conflicting late positive restores an unknown outcome;
a later freshly verified review can resolve it without rewriting that history.
Reviews perform no provider I/O. Only
requests proved not copied and stopped can be admitted for a new frozen retry.
A current replacement account never substitutes for the original. Agent, key,
plugin and system callers cannot provide this confirmation.

An erasure request cancels unstarted copies. Running, unknown and remotely
copied requests remain pending until the final original outcome and, when
copied, the original provider's erasure are verified. This is a durable core
job, so disabling forms cannot turn it into a completed receipt. Current direct
and inherited holds are checked under the shared identity lock before personal
payload minimization. Minimal original operation and erasure-cohort witnesses
survive, including
late acknowledgments. Final removal proof covers the exact current physical
facts; an older timestamp cannot settle a contradictory later observation.
Late facts reopen their original privacy receipts through the shared system
service. A bounded core reconciliation closes the crash window after reply
commit; a missing or corrupt original artifact leaves its request in progress
and requires restoration of the exact original receipt. No replacement scope
or artifact is invented; no clock, current address, account replacement or missing
local row supplies evidence of a remote deletion. Payload retention policies
can minimize settled encrypted bodies without deleting their witnesses.

Migration 79 renames the form answer column so an older worker fails before
reading an enquiry for provider I/O. Historical accepted submissions enter an
explicitly unknown inventory unless
durable event provenance proves they were never site-form submissions. The
inventory invents no destination, credential binding, physical caller or
provider result. Fresh human original-provider final/removal proof can resolve
that historical debt; a legacy row can never be admitted for a new POST.
Existing events without an original notice or destination cannot be copied
into today’s account. Restore matching database/private keys and guarded
image together for rollback. Missing receipt keys block reuse of retained
witnesses. Preserve original backup and evidence; do not replay legacy events
into today's provider account.

The actual acceptance still needed is a named-account submission and receipt,
original-account mismatch/refusal, rate-limit and lost-acknowledgment behavior,
stopped-caller recovery, original-provider erasure and privacy completion, and
confirmation that no private page capability is sent. Local intercepted HTTP
and fixture SQL controls do not supply that acceptance or the owner's security
sign-off.

Form purge prepares this evidence before deleting its parent. Retired settled
copies detach and minimize under the current identity/hold guard; unresolved
remote work refuses the whole transaction. The scheduled trash sweep uses the
same preparation boundary and rechecks final eligibility before deletion.
Unstarted retired copies cancel their original queue delivery without contacting
the provider. Two local PostgreSQL controls cover the settled manual purge and
unstarted scheduled sweep, including later original queue delivery with zero
provider requests. Migration79 remains unjournalled until its preceding source
migrations are composed; no contiguous upgrade acceptance is claimed here.
