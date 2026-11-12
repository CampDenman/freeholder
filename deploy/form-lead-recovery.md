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
proof stays distinct from observed HTTP replies; a conflicting late positive
reply restores an unknown outcome. Reviews perform no provider I/O. Only
requests proved not copied and stopped can be admitted for a new frozen retry.
A current replacement account never substitutes for the original. Agent, key,
plugin and system callers cannot provide this confirmation.

An erasure request cancels unstarted copies. Running, unknown and remotely
copied requests remain pending until the final original outcome and, when
copied, the original provider's erasure are verified. This is a durable core
job, so disabling forms cannot turn it into a completed receipt. Current direct
and inherited holds are checked under the shared identity lock before personal
payload minimization. Minimal original operation witnesses survive, including
late acknowledgments; no clock, current address, account replacement or missing
local row supplies evidence of a remote deletion. Payload retention policies
can minimize settled encrypted bodies without deleting their witnesses.

Migration 79 renames the form answer column so an older worker fails before
reading an enquiry for provider I/O. Existing events without a rendered notice
or original destination remain explicitly unproven; migration creates no
invented account bindings. Restore matching database/private keys and guarded
image together for rollback. Missing receipt keys block reuse of retained
witnesses. Preserve original backup and evidence; do not replay legacy events
into today's provider account.

The actual acceptance still needed is a named-account submission and receipt,
original-account mismatch/refusal, rate-limit and lost-acknowledgment behavior,
stopped-caller recovery, original-provider erasure and privacy completion, and
confirmation that no private page capability is sent. Local intercepted HTTP
and fixture SQL controls do not supply that acceptance or the owner's security
sign-off.
