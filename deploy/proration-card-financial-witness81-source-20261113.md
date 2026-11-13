<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Card financial-reader composition — 2026-11-13

C1.08/C9.33/C12.38. Finite SOURCE ONLY continuation on composed `e0e623ca`,
including frozen Carrier `dd9a5088` and the unchanged first17 adapter families.
MASTER §43 remains the only product/status authority. No compiler, lint,
tests, database, native, build, install or provider operation ran. No SQL,
root-owned central reader, current cash module, card schema/service/helper,
namespace, signature or original caller changes. This unwired internal
composition has no separate user-facing changeset and closes no gate.

## Compatible adapter contract

`prorationFinancialWitness(tx,{kind,ids})` keeps version1,
`entries/incomplete`, exact root selectors and deterministic entries. The new
`family:"card"` is the sole family-value addition; original `money`,
`proration`, `fee`, `boundary` values and source/target/inherited credit closure
remain unchanged. All17 earlier and seven card families share the same5000
distinct-row bound, sentinel5001 selections and missing/contradictory-parent
refusal. No old evidence is interpreted as an empty card history.

| New exact table | Entry ID | Additional actual parents |
| --- | --- | --- |
| `subscription_proration_payment_protocols` | Actual payment UUID | Accepted invoice/proration/subscription/frozen profile |
| `subscription_proration_card_mandates` | Actual proration UUID | Accepted invoice/proration/subscription/profile, local method UUID |
| `subscription_proration_card_attempts` | Actual payment UUID | Actual mandate/method, protocol, accepted target ancestry |
| `subscription_proration_card_jobs` | Original unique job UUID, matching Carrier's witness identity | Actual mandate/proration and actual job UUID |
| `subscription_proration_card_reads` | Actual independent read UUID | Actual payment/protocol and accepted target ancestry |
| `subscription_proration_card_read_finishes` | Actual original read UUID | Actual retained read/payment/target |
| `subscription_proration_card_read_stops` | Actual original read UUID | Actual retained read/payment/target |

The only new parent-key names are `readId`, `jobId`, `paymentMethodId`.
Their values are actual local UUIDs. No provider method/customer token,
signature, nonce, process birth, reviewer, account, hosting evidence or
original task body is returned. Every fingerprint still hashes the FULL
physical PostgreSQL row; safe parent projections never replace that hash.
The immutable original bodies stay unchanged in PostgreSQL.

## Exact selection and integrity

Protocol, mandate and attempt rows must retain their actual accepted
proration's debit invoice and exact canonical subscription source ID. Payment
and original request invoice FKs must agree. Mandates retain their actual
accepted quote/method identity; current account/contact/method-active state is
not used to reconstruct historical ownership. Actual jobs retain their
original task/proration/job identities; current queue bodies are not invented.

Independent reads follow actual payment→invoice→accepted debit/profile and
the exact captured original protocol. Saved AND hosted recovery are covered;
requiring a stored-method attempt/mandate would wrongly omit legitimate hosted
reads. Actual signed payload UUIDs must match original read/payment/proration.
Finishes and stops separately follow the actual read FK and same ancestry;
mutual contradictory receipts refuse. Referenced protocol, mandate, original
job and read entries must be present in the complete selected inventory.

Merchant selection stays anchored to the adapter's exact frozen-profile
proration roots. It does not pass a mixed invoice's entire payment set to a
whole-invoice helper. Cross-profile, missing or contradictory parents refuse
instead of borrowing amount, email, current account or a later successful
reader. An actual unfinished read remains hashed financial history; this
dependency witness does NOT claim it finished or authorize erasure. Existing
signed-proof verification, creator/read quiescence, human runtime-stop policy
and current original cash/debt authorities remain independently required.

## Root mapping and qualification

Root's central readers must recognize exactly the seven table names and new
`card` family value. Keep internal table+actual-ID identity in any map and
table-bound fingerprints in existing parsed undo receipts. All new IDs are
UUID, so no widening of the ordinary undo ID schema is needed. Do not create
an unrecognized evidence kind merely by concatenating this new family name;
fold it into an existing actual-invoice/subscription financial fingerprint or
explicitly declare any new strict UUID kind in the parser. Existing feedback
`namespaceDigest:feedbackUUID` identities and all five cash arrays remain
byte unchanged, including receipt-only/ownerless/GET-less raw facts.

The seven card tables depend on Carrier's owned UNAPPLIED card suffix. Root
owns fresh assembly/new hash/new DB/parity qualification. Existing failed
databases, captured history and all earlier qualification artifacts remain
untouched. The provider-preview WIP and future controlled-charge bridge are
outside this finite checkpoint and have not been silently adopted.

Seven prepared synthetic read-driver groups are UNRUN: hosted unfinished
read ancestry with no stored-method attempt; all seven saved families with
distinct read finish/stop IDs; frozen-profile/mixed-invoice selection;
missing protocol/mandate/job refusal; contradictory original parent or
finish/stop refusal; full private-row hash sensitivity without body projection;
and per-card plus first17/card combined overflow. They compile actual SQL
against synthetic responses and prove no native SQL, cryptographic, caller,
transaction, concurrency, recovery or provider acceptance until executed and
supplemented by actual fresh native controls. Full source/combined/private
merchant export/root integration and independent review remain required.
