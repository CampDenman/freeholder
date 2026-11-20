<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C3.47 original HTTP media-key privacy boundary

The unchanged b716e252 control genuinely failed after 6.065 seconds in the
selected case (12.03-second runner): actual robots/page PUTs and DELETEs had
retired, the original generation capture contained one source and two responses,
and the privacy receipt said completed/erased with no pending jobs. Header,
catalog and entry projections were minimized, but the unaccepted media row's
key still contained the fictional reader email in its original image URL.
There was no accepted plan, batch, asset or image fetch. The populated V9 failure
is preserved unchanged; its original physical bytes were actually deleted.

This source repair adds a separate immutable source-key digest to shared media.
The actual HTTP catalog insertion supplies it; SQL checks that first capture
against the actual key. No old NULL witness is inferred or backfilled. An
unaccepted media key can become `redacted:<original-row-UUID>` only after an
actual complete erasure scope includes its original source/generation and all
original physical facts are retired without a current hold. The row UUID,
source-key digest, content digest and existing business ownership stay bound.
The digest is private and is absent from the shared public graph DTO.

An accepted plan, admitted batch, asset, file-byte receipt or unresolved lease
blocks this reduction. Current services refuse before admitting physical DELETE
and recheck in the final projection transaction; SQL independently checks the
actual normalized witnesses. Such work needs explicit business recovery and
cannot receive a false erased acknowledgement. Completion also checks the
media key, planned projection and error field. A writer flag alone is insufficient.

The migration81 draft has changed and remains unjournalled. Existing 4669 SQL
databases, the V9 failure, real501 V7 state, current-positive V8 and all history
goldens remain untouched. Qualification requires a NEW database with the new
draft, eight Crawl models plus shared-media column parity, the unchanged b716
oracle and admitted/held negative controls. No new SQL or native acceptance is
claimed by this source checkpoint. Ordinary81/public activation, owner recovery,
provider proof and C3.47 remain open.
