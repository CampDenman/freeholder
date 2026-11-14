<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original applied-review retirement consumer — source only

This finite C1.12/C11.08 dependency follows frozen89b3b031. No compiler, lint,
test, parser, model import, database, migration, native, provider-account or
host action ran. The complete request capability and dedicated multipart part
capability remain unpublished. No stable, platform or provider acceptance is
claimed, and no existing original oracle is replaced.

A genuine single create-only original PUT can have an independently verified
executor stop and an affirmative original nonce/full-byte/two-pass inventory
review while its actual caller return, physical return and writer finish remain
NULL. The previous ordinary retirement producer rejected that case even after
its guarded applied review completed. A portable finished lost-reply PUT also
became `stopped` after review and was rejected by the old `state=returned` check.

The internal cleanup consumer now loads only the exact original caller's
immutable applied review. The new SQL predicate
`freeholder_media_original_applied_review(uuid)` independently requires the
original receipt UUID/runtime/namespace, retained review evidence digest, exact
original read and physical nonce/token, complete first positive inventory,
actual read/page finishes, and either all portable actual original finishes or
the review's exact independently verified stop. The producer rereads the stored
positive pages, recomputes their hashes, and revalidates original payload/nonce,
revision, complete inventory and executor identity. It does not recompute or
replace the old first-capture witness from the changed canonical state.

Only that distinct authority permits the existing conditional retirement
producer to continue. It still requires a NEW finished nonce-bound original
revision read and two complete agreeing inventories before the exact conditional
DELETE. After actual DELETE return it needs another fresh pinned absence read
and two complete agreeing physical inventories. Other generations, unknown
legacy births, additional writers, holds, owned pointers, multipart resources
and transfer copies still refuse. A released authentic historical stop can
remain evidence for its exact original executor; a live namespace drain still
blocks new mutation under the separate namespace/controller guards. No old
PUT or acknowledged DELETE is replayed.

The original actual return and writer-finish timestamps remain unchanged.
Guards additionally prohibit filling missing returns/finish or replacing the
first applied review after it is sealed. Authentic late observations may still
commit and reopen `unknown` debt; they are not hidden to preserve a completed
state. The strict portable `requireOriginalPutRetirementProof` still requires
all actual finishes. Its fresh physical-absence portion is shared internally
with the separately validated review consumer; absence alone supplies no
quiescence authority.

Retirement/minimization predicates also consume the exact applied review instead
of requiring invented timestamps. Already guarded locator/descriptor/cursor
minimization must not destroy authority halfway through the same transaction:
immutable nonce/digest/review links survive, and only evidence already minimized
through the physical-retirement guards can use the retained projection. Raw
live evidence and producer readback remain strict. Complete cursor inventory
cannot be replaced by a missing current key. Exact-token quota release still
occurs in the same final retirement transaction, and raw-key minimization is
separate from proving provider-byte retirement.

Prepared, UNRUN controls: nine pure cases cover stopped positive proof with NULL
returns, portable review, missing/substituted review links, incomplete/different
inventory, nonce/descriptor mismatch, wrong stop/runtime, retained versions or
sessions, and fresh finished absence after review. Three native cases use the
real shared services and fictional private TCP store: portable reviewed lost
reply followed by one original conditional DELETE/no replay; guarded evidence
minimization retaining review/digest/return identity; and a real named hold
preserving bytes and the first review. They require the real complete protocol,
never create a fixture capability, mock authorization, fabricate ServiceContext
or seed an executor stop. These controls do not prove an actual Linux stop.

Actual stopped-executor acceptance remains required: in a disposable owned
Linux environment admit the single real create-only PUT with durable boot/PID/
start identity, stop that exact runtime through the existing operator witness,
retain genuine stop verification, perform fresh human affirmative original
recovery, release the drain through its real lifecycle, then invoke shared
cleanup. Prove NULL caller/physical/writer finishes remain NULL before and after
retirement/minimization, the original review/capture are unchanged, no extra PUT
or DELETE occurs, and each stage has independent journal/profile/client-drain
proof. Failed/mismatched stop, retained version/session, live hold and late
physical evidence must preserve debt. No synthetic process record substitutes
for this acceptance.

Still required: unknown DELETE without an actual successful ACK; additional
current-transfer crashed-executor association and release; complete multipart
per-request/part provenance and retirement; quota initialization/release
recovery; cutover; fresh schema/source/native qualification; actual provider and
platform acceptance. No C item or release gate is closed by this checkpoint.

## Multipart terminal authority evidence gap

Public primary AWS documentation was read, with no account calls or account
configuration inspection. AWS says in-progress part uploads can still succeed
or fail after abort; verification may require repeated aborts and ListParts.
ListParts omits unfinished part uploads. Successful completion removes parts
and UploadPart reports NoSuchUpload for a completed upload ID, but the published
completion contract assumes the relevant parts have already uploaded. We did
not find an explicit guarantee covering an already admitted or concurrently
replayed UploadPart racing completion. A presigned URL is reusable; expiry is
not an original caller finish. CompleteMultipartUpload can return an embedded
error with HTTP200, so status alone is never a successful terminal receipt.

Therefore no unconditional COMPLETE terminal/revocation authority is implemented
or claimed. A future separately retained exact provider-terminal receipt would
need a documented or independently accepted provider concurrency contract for
all outstanding issued authority and complete exact session/byte inventory.
It would remain distinct from the original caller's actual finish. Generic
S3-compatible endpoints do not inherit an AWS-specific concurrency guarantee.
Existing issued URLs/old runtimes require real authority retirement; the new
signing gate alone does not revoke them.

Primary references:

- [AbortMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html)
- [Multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [CompleteMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html)
- [UploadPart](https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPart.html)
- [Presigned URL FAQ](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/faq.html)
