<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-28

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Plan gate at this snapshot: **298 unique IDs, 280 checked,
18 open**. Refresh GitHub before treating anything below as shipped.

## C11.11 — performance budgets pass on the reference target

The §15.1 performance budgets are now measured on the actual reference
hardware, and every one of them passes:

- **Thirteen for thirteen on the $6 droplet.** The acceptance run targeted the
  provisioned `freeholder-ref` instance (nyc3, `s-1vcpu-1gb`, ubuntu-24-04,
  app image `ghcr.io/campdenman/freeholder:edge` ≈ main `204f4f7`), measured
  through the deployed surface over an SSH tunnel, against the verified medium
  dataset. Public render 203ms p95 (tunnel-adjusted; 274ms on-box), LCP 432ms
  p75, INP 16ms p75, CLS 0.00064, admin list 732ms p95, admin detail 661ms p95,
  search 499ms p95, report 544ms p95, editor first paint 488ms p95,
  keystroke→preview 119.8ms raw p95 at the harness measurement floor, queue
  1,219ms p95, migration chain 49.1s, cold boot 7.81s p95.
- **The evidence is archived, not asserted.** `deploy/perf-reference-run-2026-09-27.log`
  holds the complete run: host configuration, dataset proof, every command,
  every raw sample, computed percentiles and per-budget verdicts. The summary
  in `deploy/performance-measurements.md` records the method adaptation
  (HTTP/browser through the tunnel; queue/migration/boot timed on-droplet) and
  the honest caveats, including the keystroke row's raw 119.8ms versus its
  ≤20ms product contribution, and the 1.1ms margin on the search row.
- **The checklist box stays open, deliberately.** The C11.16
  spec-reconciliation gate orders C11.11 to remain unchecked until that gate
  is updated, and no gate was weakened to flip it early. Checking C11.11 now
  awaits the C11.16 workstream's own reconciliation-table update, with this
  run's evidence standing as the acceptance record.
- **Nothing was tuned to pass.** No swap was added, the droplet was not
  resized, no budget was raised, and no gate was weakened; the one observation
  of the single CPU starving the queue worker under concurrent measurement
  load is preserved in the log as a real behavior of the target.

## Paradise Comms provider adapter — C3.13 (live acceptance still open)

Paradisemodern's Paradise Comms is now the de-facto first-party voice/video
provider behind the existing plugin seam, per the 2026-09-27 pivot. The
Daily adapter remains in-tree as optional code and keeps serving instances
configured through `DAILY_API_KEY`/`DAILY_DOMAIN` — provider selection reads
the plugin's stored settings, and only instances with no stored row fall
back to the Daily environment, so nothing is force-migrated.

- **Provider adapter** (`plugins/voice-video/paradise.ts`,
  `paradise-provider.ts`): implements the live
  `2026-09-28.comms-recording-lifecycle` contract — rooms with policy
  (invite_only by default), participant caps and recording retention; TTL
  LiveKit credentials with TURN for host and guest; provider-confirmed room
  end where a 503 `media_termination_pending` stays retryable and fail-closed
  (the room is never marked ended until PM confirms `media_ended`);
  recording start/stop; recordings list/get/delete with 409 mid-egress and
  retryable 503 semantics. PM's prepaid gate is surfaced honestly: a 402
  carries the balance and top-up URL to the room row and the setup screen,
  and reads/stops are never budget-gated.
- **Settings** (`plugins/voice-video/settings.ts`): base URL, auth scheme
  (site key or legacy portfolio bearer), webhook signing secret, room policy
  and retention days, all in module settings; secrets are stored as §41
  ciphertext and never returned by any read path.
- **Inbound webhooks** (`plugins/voice-video/webhook.ts`,
  `app/api/plugins/voice-video/webhooks/paradise/route.ts`): PM's
  HMAC-SHA256 relay is verified with a five-minute timestamp window before
  any database effect, de-duplicated by envelope id in
  `voice_video_webhook_deliveries` (migration `0019`), and mapped to the
  plugin state machine — room-ended closes the local room,
  `recording.deleted`/`recording.expired` drops local provider references.
- **Recording lifecycle**: a verified recording is imported into the
  owner's storage through the existing #394 pipeline, downloading from PM's
  playback URL with the same pinned, bounded transport as Daily (512 MiB
  ceiling). Caveat: PM playback URLs are public unsigned Spaces URLs until
  PM ships signed playback — treat them as short-lived access windows.
  Transcripts stay absent; PM does not ship them yet.
- **Erasure**: contact erasure now calls `DELETE /v1/recordings/:id` for the
  contact's imported PM recordings and acknowledges the privacy receipt only
  after PM confirms; a 503 keeps the PM row and the receipt pending, and a
  409 mid-egress defers to the durable job — the same pattern as the Daily
  path.
- **Admin UI**: provider picker, encrypted secret fields, verify-connection
  probe with 402 top-up surfacing, LiveKit credential panels for host and
  guest (copy into a LiveKit client; the credentials expire within 30
  minutes), and recording start/stop controls on live rooms.
- **Coverage**: 33 new tests across `tests/core/paradise-adapter.test.ts`
  (15 mocked-HTTP client tests), `tests/core/paradise-flow.test.ts` (10
  database compositions incl. provider switching, erasure round-trip and
  import retry) and `tests/core/paradise-webhook.test.ts` (signature,
  replay and mapping). No real network in tests.
- **Locales**: en/fr/es/ar parity for the new setup and credential strings.

Live acceptance against a real paradisemodern site key (open a room, join
with a LiveKit client, record, import, erase) was open C3.13 work when this
section landed; the section below closes it same-day.

## C3.13 — live Paradise Comms acceptance closes the item

The remaining C3.13 clause — live voice/video acceptance against a real
paradisemodern instance — ran end to end on 2026-09-28 against production
`https://paradisemodern.com/v1` (contract `2026-09-28.comms-recording-lifecycle`),
from the Freeholder droplet running the post-#430 image. Every hop went through
Freeholder's real service surface; PM-side reads used only the site key for
corroboration. The sanitized transcript is
`deploy/c313-live-acceptance-2026-09-28.log`; the summary with the five proofs
(real room; live media participant on the production SFU; provider-confirmed
end; recording + owner-storage import with checksum-verified bytes; erasure
round-trip ending in PM 404 + a completed privacy receipt) is
`deploy/c313-live-acceptance-2026-09-28.md`.

- **Real media, honestly metered.** Headless Chromium (fake devices) joined the
  room with Freeholder-minted LiveKit JWTs: connected in 907 ms, audio + video
  published, 1,888,138 bytes sent. Recording start/stop through
  `voiceVideo.recordingControl` produced an MP4 whose import into owner storage
  verified byte-for-byte (sha256 on the row equals the file on disk).
- **Erasure is provider-confirmed.** Contact erasure deleted the PM recording
  (re-GET 404, empty listing), removed the owner-storage copy, and the privacy
  receipt acknowledged completion only after both durable provider jobs
  confirmed.
- **Budget.** $0.027634 of the $1.00/100-min grant; ending balance $0.972366.
- **Ops findings (no product defects).** Four environment gaps surfaced and were
  repaired with before/after evidence in the log: the acceptance site's PM
  portfolio was not provisioned for Comms (site moved to the owner's
  `campdenman` portfolio); the recording object's ACL was private despite the
  documented public playback-URL contract (repaired); the droplet's split-
  horizon DNS answered the Spaces hostname with a VPC-private IP that the
  pinned downloader's SSRF guard rightly refuses (public IP pinned in compose);
  and droplet `CREDENTIAL_KEY`/owner-storage needed configuration (set,
  documented). The adapter failed visibly and honestly at each gap, matching
  the #430 contract tests.
- **Observed PM behavior worth noting.** Credential mints returned a 60-second
  TTL (Freeholder requests 30 minutes and surfaces PM's `expires_at`
  faithfully); the earlier release note's "expire within 30 minutes" reflects
  the request, not PM's current grant.

`MASTER.md` C3.13 is checked; `deploy/f-criteria-matrix.md` F12 is updated.
