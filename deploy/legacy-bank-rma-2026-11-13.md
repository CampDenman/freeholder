<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original legacy RMA and bank-feedback source checkpoint

MASTER §43 C5.19/C12.38/C1.08. This isolated increment is SOURCE ONLY and
UNQUALIFIED. No compiler, lint, test, dependency installation, build, database
migration, native execution or real provider request ran for this increment.
The controls below are prepared, not passing evidence. No checklist closure,
merchant-model activation, provider acceptance or stable sign-off is claimed.

The actual existing return allocation chooses ownership by return/allocation/
payment IDs and original keys. Its already-created credit and actual returned
invoice-line identities must agree. Neither an equal refund amount nor an
inferred same-price line can choose the owner. The credit digest preserves
financial line identity across draft-to-issued progression and excludes mutable
status, free text and later privacy minimization. Recovery does not create or
edit a credit, credit line or original payment principal. Initial completion may
issue the existing draft credit through the original shared lifecycle.

Human-authorized causal children use the frozen original allocation prefix and
exact parent refund UUID. Their purpose-separated HMAC includes the actual
return, allocation and credit witness, all parent/child refund IDs and original
HMAC authority. Existing non-RMA signatures retain their prior shape. Separate
failed generations of one actual allocation reserve one original business
obligation; active reservations and positive cash remain fully counted. Other
original parts and independent promises retain their own owed capacity.

The same catalog services back owner recovery, generated HTTP/MCP contracts and
return actions. Replacement requires fresh verification, a signed-in human,
no API key and explicit original-return confirmation. Checking performs only
actual reads. The customer sees confirmed original-part totals and a reminder
that the original payment remains paid; no private bank/caller details escape.
A raw refunded return is presented as received while actual bank debt remains,
even before a later workflow callback has updated its stored lifecycle.

## Raw signed feedback before the first GET

A new sixth legacy model, `legacy_bank_feedback`, retains only normalized
financial facts: actual observed refund/PaymentIntent/charge/account/platform/
protocol identifiers, nullable raw/mapped status, money, failure identifiers,
event/receipt times, exact raw body SHA-256 when available, and upstream exact
byte HMAC verification provenance. Customer metadata is excluded. The actual
retained occurrence receives a purpose-separated HMAC. Its immutable observed
namespace is separate from unknown original create platform/protocol, which
remain null. Direct older normalized callers without a raw byte digest retain
null rather than an invented digest. Healthy duplicates reuse the exact row;
a corrupt prior row is preserved and a genuinely new callback occurrence is
retained before reporting authentication repair debt.

The raw receipt commits in its own short shared-service mutation before the
applying transaction. It also commits when original scoped retention policy
fails, before propagating that failure. Genuine unassigned feedback stays
unassigned when no authentic old namespace or stored resource binding exists.
An authentic original admission can own review of its payment/account namespace
while its real creator is outstanding. That ownership does not assign the new
resource to that caller, manufacture its finish or settle money. Amounts never
select ownership. Contradictory observed identity/money is retained and prevents
current money proof; every observed raw resource must occur in the actual
complete cash inventory before a fresh current receipt can be issued.

A narrow original ACK setting allows only the actual server-held creator's
independently retained, non-recovery finish to bind its first real provider
reference. It changes no status or cash. If feedback arrived while that creator
was paused, its older successful result cannot bypass fresh current proof after
its actual return. Corrupt original admissions preserve the actual finish as
repair evidence and do not bind a speculative reference.

## Parent integration ownership

The owned helper `legacyBankReadFinancialWitness(tx, exactOriginalRefundIds)` now
returns seven arrays: `reads`, `facts`, `finishes`, `current`, `stops`,
`replacements`, `feedback`. Their aggregate bound remains 5000. Feedback entries
are `{ refundId, namespace, feedback }`; `namespace` comes from
`originalLegacyBankAdmissionNamespace`, which authenticates the actual old
admission and immutable original payment tuple without selecting today's
account. `legacyBankFeedbackReviewOwned(tx, refundId)` calls
`freeholder_legacy_bank_feedback_review(uuid)`. The SQL review predicate also
matches an exact stored refund reference so contradictory observed PI fields
cannot silently disappear from review. JavaScript authenticates all retained
raw rows before they can contribute to financial or current-state proof.

The root owns central/invoice financial-witness integration. Its legacy source
selection must include actual review-owned original refunds before the first
read, join `feedback` into both histories and include it in aggregate bounds.
The three root-owned financial-witness files are unchanged by this increment.
The local chain helper now accepts a real `ServiceContext` rather than a naked
transaction so it can call the actual private catalog ownership service inside
the same transaction. No fabricated contexts or merchant requests are used.

## SQL and prepared qualification

`deploy/legacy-bank-rma80.fragment.sql` is a separate UNAPPLIED suffix after the
unchanged recovery fragment. Its SHA-256 is
`5c2a285cc619a2fcd7a4314e98ac62a08f7a842e1740a245cfaf6e5ed1d07a11`.
It adds the raw model/immutable guard, exact old namespace review predicates,
raw feedback freshness, capacity debt and current projection/balance guards.
The reader requires all 13 enabled guards and the new review function; recovery
admission requires six enabled recovery guards and that function. The previous
image fails closed on this expanded money domain; rollback requires the
pre-upgrade database. No candidate was assembled or applied here. The recovery
fragment remains `d4ae54e3b8b9f93b28b98a6e5f42d9f98835353f221f3290afbd8613a9f9a3f0`
and the parenthesized current fragment remains
`73a89f9dcc9b79bca72b713f53db81949c27cdd805f0fc05714cae6ea2203678`.

Prepared controls are 38 pure, five contract and five native cases:

- Actual RMA credit/lines survive nullable, action, pending, failed and restored
  bank states. An equal unrelated refund does not close the part. A signed
  exact original-part replacement closes it once; replay makes no extra POST.
- A test-owned trigger refuses the actual later return closure after positive
  facts/current proof/cash commit. The same original credit closes after that
  later fault is removed, without a new physical refund.
- Foreign feedback before any GET permits undo; actual owned raw feedback
  after a new merge blocks undo while refund/payment rows remain unchanged.
  Canonical invoice/contact ownership is preserved on refusal. This fixture
  needs the root's before-first-read witness integration.
- Feedback during an accepted paused original creator is retained without
  inventing a provider reference, read ticket or finish. Only its actual return
  persists the first ACK; a later real current read applies money.
- Actual signed contradictory amount facts commit before applying policy
  rejects them, retaining original positive cash, credit and explicit debt.

The raw/current identity controls also require the observed original charge,
account and platform to agree with the one actual resource in complete cash
inventory. A later bank-status change can be reconciled without rewriting an
older immutable receipt; contradictory identity or an equal unrelated resource
retains review. These additional pure controls are prepared and UNRUN too.

The native fixtures use actual checkout/return services, original HMAC physical
admissions and the real Stripe adapter with bounded synthetic HTTP responses;
no ServiceContext, historical capture or first scope is fabricated. They keep
60-second per-case deadlines, stop/join the actual producer and close clients.
All five prior lifecycle, three current and five recovery fixture bodies are
unchanged here, including the old stopped-child loader fixture: the root's later
async-main/universal-tsx/IPC corrections must remain when integrating.

After source integration: bounded full types/lint/pure qualification, new full
SQL assembly and parity, a genuinely new database per controlled native case,
first-failure preservation and independent UTC/current-journal/client-drain
proof remain required. Populated upgrades, browser/SDK journeys, actual provider
acceptance and independent review remain part of the full specification.


## Root feedback integration checkpoint

The local composition includes the verified recovery checkpoint3513fb24 and
signed RMA source722b53d0. The equivalent owner-form label conflict retains the
qualified matching label/textarea IDs. Prior async-main/universal-tsx/IPC
fixture corrections remain intact. The original2100 SQL is a byte prefix of
new unpublished80 SHA-256
17bf9c66942486e874f48c6b1f15aff56740176535de768e6e16142435b71f57;
no previous database is migrated or reset for this new schema.

Invoice selection now includes authentic feedback-owned original refunds before
any GET, through their exact invoice/payment ownership and the seller's frozen
payment filter. Both central refund and invoice histories include authenticated
feedback plus its original admission namespace in the complete5000-child bound.
Empty new child arrays preserve previous financial fingerprints. This supplies
the missing source hook for the prepared feedback-only merge-undo control; it
is not native or final-candidate proof. All new qualification remains pending.
