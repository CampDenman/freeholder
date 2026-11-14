<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Fresh exact original transfer read provenance — source only

This finite C1.12/C11.08 dependency follows frozen14450e2d. No compiler, lint,
test, parser, model import, database, migration, native, provider/account or
host operation ran. All original oracles/helpers are preserved. No complete
request/part capability, stable or platform/provider acceptance is published.

The actual storage protocol already returns the original request nonce/token
digest from provider metadata and retains actual metadata/body observations.
Transfer orchestration discarded that field when retaining its logical read
return. Recovery and copy/adoption could consequently compare equal bytes and
an ETag without retaining their original physical identity. A non-versioned
ETag can repeat for equal bytes; it is not by itself an admission identity.
Separately, adoption reused earlier copy-time reads instead of obtaining new
full source and target byte proofs immediately before the atomic transition.
These are pre-enable source gaps, not observations of a production account.

The actual transfer return now retains optional `requestProof` in the existing
`result_request_proof` column and in the first result digest. Ordinary transfer,
source cleanup and fresh recovery read closures pass the ACTUAL provider value.
Existing first returns are never augmented or rewritten. Old reads lacking a
nonce cannot borrow the expected value from a current receipt; a new real read
is needed. No public input can supply this retained return.

The shared source-copy, target verification, adoption and source-retirement
phases now consume the exact original create-only physical admission. The
internal proof checks every actual original finish, original request descriptor,
namespace/key, full SHA/byte bound, provider revision and actual read nonce/token.
SQL independently verifies the immutable first source membership or the exact
target caller/receipt, original runtime/finishes, actual metadata nonce and body
observations, complete read subrequest finishes and the original revision. The
new `freeholder_media_transfer_exact_read_nonce(uuid)` supplies that independent
check; the shared TypeScript consumer also revalidates the actual original
request and full-byte result. Equal current bytes/ETag or a different nonce fail.

Actual source reads are checked before any target PUT. The copy's source and
target reads are checked before it becomes verified. Source DELETE admission
and the real physical SQL mutation guard require the exact adopted target nonce
and fresh target byte proof, and final settlement repeats that check. Existing
role/controller/hold/first-generation conditional-DELETE and complete physical
inventory requirements remain. Known original revisions are now passed into
the actual metadata/body read admission and provider request; source absence
and target current reads stay pinned to their original physical generation.

Adoption obtains NEW actual full-byte source and target reads outside all
transactions for every exact object in the unchanged plan. The short apply
service requires complete unique proof membership, actual finished nonce-bound
reads after copy verification, matching immutable original revisions, unchanged
receipt inventory, ownership and holds. SQL independently refuses reused
copy-time reads. The verified checkpoint uses the database transaction timestamp
so comparison does not mix the application host clock with provider-admission
DB time. The atomic transition selects these new verified-read references;
all old read/caller/receipt rows and first inventory captures remain unchanged.
No provider I/O enters the apply transaction, and no target PUT is repeated.

No model, column, index, trigger or journal changes. One new SQL read-only proof
function and two existing guard bodies are prepared. The existing private
`media.adoptStorageTransfer` helper receives its orchestrator's complete proof
IDs; it remains external:false. Public `media.advanceStorageTransfer` input and
permissions/audit route remain unchanged. Root owns final catalog/SDK generation
and all qualification. Strong stopped-target recovery still needs its own
exact stop/positive-inventory consumer; this actual-finish read path does not
invent a missing original return or allow additional-drain release for it.

Seven pure controls are PREPARED/UNRUN: portable exact nonce, same bytes/ETag
with another physical nonce, wrong/missing token, missing original finishes,
unfinished/wrong-resource read, corrupt/overwrite/second original write and
returned target verification/current reads. Four native controls are
PREPARED/UNRUN with actual shared services and a fictional private TCP provider:
wrong source nonce refuses before target PUT; changed target nonce after copy
is discovered by new adoption read; raw SQL adoption using copy-time reads
refuses; a positive copy→fresh adoption→conditional source retirement preserves
old proofs, exact nonce identity and live original copy privacy lineage with no
extra target PUT. Fictional provider metadata changes keep the original bytes
and ETag equal to distinguish identity from a simple content mismatch. No test
overrides authorization, creates a fake ServiceContext or publishes a fixture
capability. They supply no actual provider/account acceptance before execution.

Still required: stronger stopped-applied target PUT original nonce/full-byte/
two-pass inventory and physical-row review; unknown DELETE terminal authority;
complete multipart/part/session provenance/retirement; quota initialization and
release recovery; final cutover/recovery; fresh source/schema/native validation
and actual provider/platform/operator acceptance. Untagged historical births
remain explicit debt, not candidates for current-metadata backfill. No C item
or release gate is closed by this checkpoint.
