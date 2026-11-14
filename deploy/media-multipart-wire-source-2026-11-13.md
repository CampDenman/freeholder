<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Whole multipart response evidence before session and part authority

C1.12/C11.08. SOURCE ONLY from `8777873a`. No compiler, lint, parser execution,
model imports, migrations, tests, provider/account or host operations ran. Twelve
new protocol controls are PREPARED / UNRUN. The full request and multipart-part
capabilities remain UNPUBLISHED. This finite wire prerequisite does not complete
multipart, establish caller quiescence or qualify any actual provider account.

The managed S3 multipart driver now retains a digest/size of the COMPLETE
response body before applying its parsed result. The same bounded XML reader is
shared by original provider inventory. It reads at most 2 MiB, hashes exact wire
bytes, rejects invalid UTF8/DTD/entity expansion/multiple roots, and parses one
whole document. Keep-alive whitespace before the final XML declaration does not
change the retained digest or the exact scalar key. Numeric entities and literal
entity-shaped key text decode once. Duplicate key/ETag/session scalar fields,
wrapped success substrings and nested/namespaced errors cannot confer acceptance.
A supplied Bucket must match the actual captured private binding. Redirects are
refused for every multipart request rather than moving work to another resource.

CREATE still supplies its actual server-held original request nonce in object
metadata. A callback failure retains session/ACK observations before it fails;
no CREATE or COMPLETE retry is introduced. Every part listing page must preserve
its exact key/upload ID, strict numeric sizes/ordered part numbers, unique cursor
chain and real termination. An HTTP200 ABORT error refuses ACK. A 404
NoSuchUpload is retained as an absence observation, never rewritten as an actual
ABORT acknowledgement or full byte retirement. Other404s remain errors. Existing
actual ACKs, first failed results and immutable caller/receipt identities stay
unchanged.

`response_body` is an additional append-only observation stage, including actual
late original responses. It does not grant admission, infer a FIN or backfill an
old capture. Managed drivers retain it. The low-level protocol constructor keeps
its historical optional callback surface for existing operator/protocol oracle
fixtures; those older observations cannot supply a future required full response
witness. No runtime/SQL capability or fixture enablement is added.

Primary provider contracts reviewed (public documentation only):

- [S3 multipart process](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
  describes the actual initiation UploadId as unique, warns that part listings
  omit unfinished uploads, and says successful completion consumes the parts.
  Completion uses the uploader's recorded part manifest, not a newly adopted
  listing. This does not identify another caller's missing FIN.
- [CompleteMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html)
  requires the relevant parts to have uploaded and the exact complete manifest;
  processing can send an initial200 and later return an embedded XML error.
  The full final body, not the initial status, supplies the provider result.
- [AbortMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html)
  explicitly warns that in-flight parts may still finish after abort and that
  repeated cleanup/list verification may be needed. Expiry, an empty list or
  the first abort ACK is not proof that all issued/in-flight creators ended.
- [UploadPart](https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPart.html)
  documents checksum headers and NoSuchUpload for invalid/aborted/completed
  UploadIds. Provider-specific completion/consumption behavior still needs
  genuine selected-provider concurrent acceptance before release claims.

These contracts motivate a DISTINCT provider-consumption receipt, not an
unconditional cross-provider terminal flag. Immutable checksum/size/nonce-bound
part issuances, actual CREATE/session ancestry and every legacy/issued creator
still need implementation and review. Browser callback/TTL/404-only closure
remains forbidden. No synthetic server or low-level callback is evidence of a
real AWS/compatible-provider in-flight guarantee.

Next source increment: a NEW tracked CREATE must capture complete immutable
pre-dispatch key/version/session absence, admit exactly one original physical
CREATE without retry, and preserve all namespace/birth/runtime/controller fences.
A lost reply can be positively attributed only through that exact first baseline,
independently closed original caller and complete agreeing provider inventory
showing its sole original session delta. Equal current key/time alone is never
birth. Conflicting/legacy/unknown creator cohorts, multiple candidates or an old
missing baseline refuse rather than being filled from today's inventory.
Part-body/capability receipts, fresh full completed-object SHA/nonce reads,
provider consumption versus local FIN, abort/session physical cleanup, capture
ownership, quota initialization/release, cutover and actual operator/provider/
platform acceptance remain required before the full request ABI can publish.

Original multipart protocol/adapter and provider-inventory oracle bodies are
byte-preserved. New controls cover full raw digest/heartbeat framing; appended,
wrapped and nested error bodies; duplicate scalars; DTD/unknown entities; exact
single decoding; wrong bucket; callback failure retaining CREATE evidence;
ABORT errors/404 distinction; oversized and invalid UTF8 responses. They are
bounded protocol tests, not authorization or physical account acceptance.
