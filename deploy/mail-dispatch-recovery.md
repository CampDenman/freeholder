<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original mail dispatch recovery

C3.31 and C11.08 remain open. This source increment is in qualification; it
does not supply live provider acceptance, an independent review or release
approval. Read `mail-record-retention.md` for the preceding privacy ownership
and keyed-receipt model.

The immutable `mail_dispatch_requests` row binds one staged plaintext request
to its original route through private site-keyed digests. The route snapshot is
encrypted and contains no password or API key. Its authorization fingerprint
detects credential/account changes without exposing credentials. A changed
server, account, sender, original recipient identity or body refuses before a
new physical send. Provider I/O remains outside database transactions.

Each admitted worker invocation reserves `mail_dispatches` before entering its
adapter. A running or unknown original caller blocks concurrent and automatic
retries; clock expiry, missing objects and a later positive send do not settle
an earlier caller. The worker supplies the exact physical ID as provider
correlation metadata while retaining the parent delivery ID. A bounded
20-attempt request refuses further admission instead of dropping history.

At `/admin/retention/mail/recovery`, a freshly verified person with mail
management access can record independent original-server/account evidence,
the exact final provider outcome and proof that every original caller has
stopped. Agents, plugins, personal keys and system actors cannot provide this
confirmation. The result explicitly records `human_provider_confirmation`;
it is not relabeled as an authenticated adapter response. Raw evidence prose,
addresses and private hashes are omitted from mutation audit inputs. The audit
retains the original actor, action and record IDs, while private keyed evidence
receipts retain the binding.

A human-confirmed no-submission outcome does not automatically resend. One
separate fresh decision may admit one new caller only after every earlier
caller is known not submitted. It reuses the exact original body and route;
retired recipients, route changes and missing private material refuse. A later
actual positive reply contradicting an earlier review preserves its own
reference and receipt, retains the initial human receipt, returns the request
to unknown and blocks a duplicate retry.

If the original server replies positively but ordinary local apply is refused,
the fallback retains that exact provider reference and a keyed acceptance
receipt. It keeps the request unknown instead of silently discarding the reply
or contacting the provider again. The owner sees the retained reply; a later
no-submission claim is refused. Human completion remains explicitly human
evidence and does not invent an adapter acknowledgement of the local apply.

`mail_legacy_resolutions` records explicit human evidence about older incomplete
sends. It does not fabricate original account fingerprints or individual
physical caller rows. Ordinary outcomes remain pending when those old facts
cannot be independently established. A missing original key, route, request or
captured receipt requires the matching backup; there is no generic clear button.

The `mail.records` export exposes only scoped public receipt fields. Retention
minimizes the additional provider references and encrypted route with the
original delivery. Named legal holds preserve the original body and evidence
after contact anonymization. Holding unsent evidence does not authorize
delivery after its original recipient was erased. Erasure remains pending for
unknown original calls and outstanding linked copies. An accepted send's
expired body can be removed only after its exact outcomes are settled and its
hold is no longer active.

SMTP requires certificate verification and either implicit TLS or a STARTTLS
upgrade before an envelope or body is sent. `SMTP_SECURE` selects implicit TLS
on a custom port; when empty, port 465 uses implicit TLS and other ports require
STARTTLS. `SMTP_TLS_CA` optionally trusts a private server's public CA without
disabling verification. A locally generated Message-ID alone is insufficient:
the exact recipient must be accepted, no recipient rejected, and the final
server reply must positively acknowledge submission. The positive reply is
bound into the private outcome receipt. These semantics follow the installed
transport and the [official Nodemailer SMTP documentation](https://nodemailer.com/smtp).

Migration `0072_mail_physical_dispatches.sql` follows 71. It is explicitly
schema-breaking: previous images become read-only for mail intake, outcomes,
ownership and private payloads, even if they know the older privacy capability.
Statement admission precedes row locks. Narrow, unchanged nullable actor or
sender metadata cleanup remains permitted. Existing active blocks, unknown
physical counts, references and bodies are retained; no original route or
attempt provenance is backfilled. Rollback requires the matching database,
private wrapping keys and acknowledged-erasure inventory. Keep original
wrapping material available for held or unknown encrypted evidence.

Qualification in progress: actual before failures reproduced lost-reply
duplicates, concurrent duplicates, route replacement, plaintext SMTP without
STARTTLS, incomplete/mismatched acceptance, sending held evidence after
recipient erasure and losing a later reply that contradicts human evidence.
An additional actual identity-fence failure demonstrated a dropped positive
reply during local apply; the repaired case preserves it without resending.
Current finite PostgreSQL, loopback TLS, privacy and populated-upgrade controls
are being integrated with the broader mail, SDK, owner-browser and protected
CI checks. Carrier-specific consent/retry protocols and live inbox placement
require their own C3.31 evidence; SMTP tests do not claim those acceptances.
