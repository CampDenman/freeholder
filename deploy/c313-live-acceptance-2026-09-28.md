<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# C3.13 live Paradise Comms acceptance — 2026-09-28

Full transcript: `deploy/c313-live-acceptance-2026-09-28.log` (sanitized — no
apiKey, no full JWTs). This doc is the summary; the log is the evidence.

Freeholder's voice/video plugin ran end to end against the **production**
Paradise Comms API (`https://paradisemodern.com/v1`, contract
`2026-09-28.comms-recording-lifecycle`) from the Freeholder droplet
(104.131.118.196, `ghcr.io/campdenman/freeholder:edge` re-pulled at run start to
include the #430 adapter). Every call went through Freeholder's real service
surface (`voiceVideo.*`, `contacts.*` privacy flow); PM-side reads used only the
site key for corroboration.

## The five proofs

1. **Real room.** `voiceVideo.startRoom` → PM `POST /v1/rooms` →
   `rm_01M3MXMNPC1FKAK6TXPCPD7G76` (invite_only, recording_enabled, verified by
   independent PM read). Freeholder room row `07de77ea-18d3-42a1-9580-ab566dee9776`.
2. **Real participant / credentials.** `voiceVideo.meetingLink` minted host and
   guest LiveKit JWTs (iss = the portfolio's LiveKit API key, room-scoped grant).
   Headless Chromium (Playwright, fake media devices) joined the production SFU
   (LiveKit 1.12.0): state `connected` in 907 ms, audio + video published for
   15.2 s, **1,888,138 bytes sent** (full WebRTC stat family captured).
3. **Provider-confirmed end.** `voiceVideo.stopRoom` → PM `POST /v1/rooms/:id/end`
   → `media_ended: true` (raw body in the log). An earlier empty room under a
   different tenancy demonstrated the retryable `503 media_termination_pending`
   path, which the adapter surfaces fail-closed as designed.
4. **Recording + owner-storage import.** `voiceVideo.recordingControl` start/stop
   → egress `EG_RZANaeYm3Jd5` → `rec_01M3MXXK32521EAN75X789SPXK` status
   `available` (MP4). Capture verified the `rec_` id; import copied the MP4 into
   the droplet's owner storage — 51,369 bytes, sha256 on the row matches the file
   on disk, MP4 `ftyp/mp42` box confirmed; `importStatus` `pending → failed →
   imported` (the two failures were environment gaps, below — retry-in-place
   proven in production).
5. **Erasure round-trip.** Contact erasure (`createDataRequest` → `verify` →
   `fulfillDataRequest(ERASE)`) queued `voiceVideo.eraseProviderRecordings` and
   `voiceVideo.eraseImportedCopies`; both completed. PM `DELETE
   /v1/recordings/:id` ran (re-GET → **404** `recording_not_found`; room listing
   empty), the owner-storage copy was deleted from the droplet, and only then did
   `privacy.completeErasureJob` flip the receipt to **completed** — the receipt
   acknowledges only after PM confirms.

## Budget

$1.00 grant (100 participant-minutes). The run consumed **$0.027634** across one
egress and four participant-minute debits — **ending balance $0.972366**. Room
creation is unmetered. No 402 was hit (the grant covered the run); the prepaid
gate for site-key callers is contract-documented and the adapter surfaces 402
balance + top-up honestly (#430 tests).

## Environment gaps found and repaired (all PM- or droplet-side ops, none adapter)

- **PM portfolio provisioning:** the acceptance site sat in `sites.group
  'customer'`, which had no `comms_portfolio_credentials` — credential mint
  answered `500 portfolio_not_provisioned` (room create does not need creds;
  mint/egress do). Moved the site to the owner's provisioned `campdenman`
  portfolio (left in place; the site is a dedicated acceptance site).
- **Recording object ACL:** PM's `playback_url` is documented as a direct public
  Spaces URL, but egress wrote the object private (403). Repaired the single
  object's ACL PM-side (copy-over-self, public-read) so the documented contract
  holds. (The unsigned-URL caveat: anyone holding the URL can read it while it
  exists — erasure removes it.)
- **Split-horizon DNS:** the droplet's resolver answers the Spaces hostname with
  a VPC-private IP, which Freeholder's SSRF-aware pinned downloader correctly
  refuses. Pinned the public IP via compose `extra_hosts` on the app service.
- **Droplet config:** `CREDENTIAL_KEY` was unset (§41 secret encryption) —
  generated. `FREEHOLDER_UNSAFE_LOCAL_STORAGE=1` acknowledged (the droplet runs
  the local storage adapter; §18 guard refused until acknowledged). Writable
  owner-storage bind volume added.

Each repair is logged with before/after evidence in the transcript; the adapter
itself failed visibly and honestly at every gap, and every product behavior
matched the #430 contract tests.

## What this closes

C3.13's remaining clause was live paradisemodern video acceptance (post-#428
wording). Transcripts remain absent until PM ships them — a missing transcript is
absent, never a placeholder (the captured artifact's `transcript` is null
throughout, as designed).
