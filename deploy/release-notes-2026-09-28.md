<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-28

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Refresh GitHub before treating anything below as shipped.

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
with a LiveKit client, record, import, erase) remains open C3.13 work and
is named in `deploy/first-party-plugins.md`.
