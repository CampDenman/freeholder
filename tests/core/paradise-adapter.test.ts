// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Paradise Comms room, credential, recording and erasure contracts
// without live calls. Mirrors tests/core/daily-adapter.test.ts.
import { describe, expect, it, vi } from "vitest";
import type { getPinnedBytes } from "@/core/http/pinned-download";
import { createParadiseClient, ParadiseError } from "../../plugins/voice-video/paradise";

const config = { baseUrl: "https://paradisemodern.com/v1", authScheme: "site_key" as const, apiKey: "pm-site-key", portfolioToken: null };
const roomId = "rm_01J8ZQ6KM2B1T0ABCDEFGHJ5K9";
const otherRoomId = "rm_01J8ZQ6KM2B1T0ABCDEFGHJ5KA";
const recordingId = "rec_01J8ZQ6KM2B1T0ABCDEFGHJ5K9";
const now = Date.UTC(2026, 8, 28);
const room = { id: roomId, name: "Consultation", owner_id: "freeholder:00000000-0000-4000-8000-000000000001",
  state: "live", policy: "invite_only", max_participants: 20, recording_enabled: true, ended_at: null };
const credentials = { room_id: roomId, participant_id: "u-1", role: "host", livekit_url: "wss://livekit.example.test",
  token: "livekit-jwt", ice_servers: [{ urls: ["stun:turn.example.test:3478"] }], expires_at: "2026-09-28T01:00:00.000Z" };
const recording = { id: recordingId, object: "recording", source_type: "room", source_id: roomId,
  status: "available", format: "mp4", storage_key: "comms/demo/room/f.mp4",
  playback_url: "https://bucket.nyc3.digitaloceanspaces.com/comms/demo/room/f.mp4",
  egress_id: "eg_1", duration_seconds: 42, size_bytes: 1024, created_at: "2026-09-28T00:00:00.000Z", expires_at: null };
const refused = (status: number, body: unknown) => Response.json(body, { status });
const client = (fetcher: typeof fetch, download?: typeof getPinnedBytes) =>
  createParadiseClient(config, fetcher, () => now, download);

describe("Paradise Comms live client", () => {
  it("creates an owner-named room with policy, recording options and a deterministic idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...room, state: "idle" }));
    const created = await client(fetcher).createRoom({ name: "Consultation", ownerId: "freeholder:room-1",
      policy: "invite_only", maxParticipants: 20, recordingEnabled: true, retentionDays: 30 });
    expect(created).toMatchObject({ id: roomId, name: "Consultation", policy: "invite_only", recording_enabled: true });
    const request = fetcher.mock.calls[0]!;
    expect(request[0]).toBe("https://paradisemodern.com/v1/rooms");
    expect(request[1]).toMatchObject({ method: "POST", redirect: "error", headers: { "x-api-key": "pm-site-key" } });
    expect(JSON.parse(request[1]!.body as string)).toMatchObject({ name: "Consultation", policy: "invite_only",
      recording: { enabled: true, tracks: "composite_only", retention_days: 30 } });
    expect(request[1]!.headers).not.toHaveProperty("Authorization");
  });

  it("sends the legacy portfolio token as a bearer credential and never as an api key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ rooms: [] }));
    const bearer = createParadiseClient({ baseUrl: config.baseUrl, authScheme: "portfolio_token", apiKey: null, portfolioToken: "mvf_live_abcdef0123456789abcdef0123456789abcdef0123456789ab" }, fetcher, () => now);
    await bearer.verifyConnection();
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: "Bearer mvf_live_abcdef0123456789abcdef0123456789abcdef0123456789ab" });
  });

  it("refuses to start without a credential or with an unsafe base URL", () => {
    expect(() => createParadiseClient({ baseUrl: config.baseUrl, authScheme: "site_key", apiKey: null, portfolioToken: null }, fetch, () => now))
      .toThrow("site API key");
    expect(() => createParadiseClient({ baseUrl: "http://insecure.example/v1", authScheme: "site_key", apiKey: "k", portfolioToken: null }, fetch, () => now))
      .toThrow("https");
  });

  it("mints host and participant credentials tied to the requested room and participant", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(credentials));
    const result = await client(fetcher).createCredentials({ roomId, participantId: "u-1", role: "host", ttlSeconds: 1800 });
    expect(result).toMatchObject({ token: "livekit-jwt", livekit_url: "wss://livekit.example.test", role: "host" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ participant_id: "u-1", role: "host", ttl_seconds: 1800 });
    const mismatched = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...credentials, room_id: otherRoomId }));
    await expect(client(mismatched).createCredentials({ roomId, participantId: "u-1", role: "participant", ttlSeconds: 1800 }))
      .rejects.toThrow("did not verify");
  });

  it("treats a 409 on credentials as the room being closed", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(refused(409, { error: { code: "room_ended", message: "Room is in terminal state 'ended'" } }));
    await expect(client(fetcher).createCredentials({ roomId, participantId: "u-1", role: "host", ttlSeconds: 1800 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("ends a room only on provider-confirmed media end and keeps 503 termination pending retryable", async () => {
    const confirmed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...room, state: "ended", media_ended: true }));
    await client(confirmed).endRoom(roomId);
    expect(confirmed.mock.calls[0]![1]!.method).toBe("POST");
    const pending = vi.fn<typeof fetch>().mockResolvedValue(refused(503, { ...room, state: "ended", media_ended: false,
      error: { code: "media_termination_pending", message: "Room closed; media shutdown is pending. Retry this request." } }));
    await expect(client(pending).endRoom(roomId)).rejects.toThrow("media shutdown is pending");
    const unconfirmed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...room, state: "ended" }));
    await expect(client(unconfirmed).endRoom(roomId)).rejects.toThrow("still ending this call's media");
  });

  it("starts and stops room recording with verified room ownership", async () => {
    const starting = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...recording, status: "active" }));
    const started = await client(starting).startRecording({ roomId, audioOnly: true });
    expect(started).toMatchObject({ id: recordingId, status: "active" });
    expect(JSON.parse(starting.mock.calls[0]![1]!.body as string)).toEqual({ audio_only: true });
    const stopping = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...recording, status: "stopping" }));
    expect(await client(stopping).stopRecording(roomId)).toMatchObject({ status: "stopping" });
    const idle = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, message: "No active recording." }));
    expect(await client(idle).stopRecording(roomId)).toBeNull();
    const wrongRoom = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...recording, source_id: otherRoomId }));
    await expect(client(wrongRoom).startRecording({ roomId, audioOnly: false })).rejects.toThrow("did not verify");
  });

  it("pages the recording list and rejects inventories from another room", async () => {
    const first = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ object: "list", data: [recording], has_more: true, limit: 50, offset: 0 }))
      .mockResolvedValueOnce(Response.json({ object: "list", data: [], has_more: false, limit: 50, offset: 50 }));
    const page = await client(first).listRecordings({ roomId, limit: 50 });
    expect(page.hasMore).toBe(true);
    await client(first).listRecordings({ roomId, limit: 50, offset: 50 });
    expect(first.mock.calls[1]![0]).toContain("offset=50");
    const foreign = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ object: "list", data: [{ ...recording, source_id: otherRoomId }], has_more: false, limit: 50, offset: 0 }));
    await expect(client(foreign).listRecordings({ roomId })).rejects.toThrow("complete recording list");
  });

  it("exposes a playback URL only for available recordings and bounds the reported access window", async () => {
    const access = vi.fn<typeof fetch>().mockResolvedValue(Response.json(recording));
    expect(await client(access).recordingAccess(recordingId)).toEqual({ downloadTokenUrl: recording.playback_url,
      expiresAt: Math.floor(now / 1000) + 3600 });
    const processing = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...recording, status: "processing", playback_url: null }));
    await expect(client(processing).recordingAccess(recordingId)).rejects.toThrow("not ready");
    const expired = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...recording, expires_at: "2026-09-27T00:00:00.000Z" }));
    expect((await client(expired).recordingAccess(recordingId)).expiresAt).toBe(Math.floor(new Date("2026-09-27T00:00:00.000Z").getTime() / 1000));
    const credentialUrl = new URL(recording.playback_url);
    credentialUrl.username = "user";
    const unsafe = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...recording, playback_url: credentialUrl.href }));
    await expect(client(unsafe).recordingAccess(recordingId)).rejects.toThrow("unsafe");
  });

  it("downloads available recordings through a bounded credential-free storage request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(recording));
    const download = vi.fn<typeof getPinnedBytes>().mockResolvedValue({ status: 200, contentType: "video/mp4", bytes: new Uint8Array([1, 2, 3]) });
    await expect(client(fetcher, download).downloadRecording(recordingId)).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "video/mp4" });
    expect(download).toHaveBeenCalledWith(recording.playback_url, { maxBytes: 512 * 1024 * 1024, timeoutMs: 60000 });
  });

  it("deletes recordings with provider-confirmed, mid-egress and retryable semantics", async () => {
    const gone = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: recordingId, object: "recording", deleted: true }));
    await client(gone).deleteRecording(recordingId);
    expect(gone.mock.calls[0]![1]!.method).toBe("DELETE");
    const midEgress = vi.fn<typeof fetch>().mockResolvedValue(refused(409, { error: { code: "recording_not_finished", message: "Stop the egress first" } }));
    await expect(client(midEgress).deleteRecording(recordingId)).rejects.toMatchObject({ status: 409 });
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(refused(503, { error: { code: "recording_delete_failed", message: "Spaces unavailable", retryable: true } }));
    await expect(client(unavailable).deleteRecording(recordingId)).rejects.toMatchObject({ status: 503 });
    const unknown = vi.fn<typeof fetch>().mockResolvedValue(refused(404, { error: { code: "recording_not_found" } }));
    await expect(client(unknown).deleteRecording(recordingId)).rejects.toMatchObject({ status: 404 });
  });

  it("surfaces the prepaid 402 with balance and top-up URL on cost-starting calls, never as a transport error", async () => {
    const body = { error: { code: "insufficient_balance", message: "Balance is empty", balance_usd: 0, top_up_url: "https://paradisemodern.com/billing/top-up" }, message: "Balance is empty" };
    const gated = vi.fn<typeof fetch>().mockResolvedValue(refused(402, body));
    const attempt = client(gated).createRoom({ name: "Consultation", ownerId: "freeholder:room-1", policy: "invite_only", maxParticipants: 20, recordingEnabled: false, retentionDays: null });
    await expect(attempt).rejects.toMatchObject({ status: 402, balanceUsd: 0, topUpUrl: "https://paradisemodern.com/billing/top-up" });
    await expect(attempt).rejects.toThrow("Top up at https://paradisemodern.com/billing/top-up");
    const gatedCredentials = vi.fn<typeof fetch>().mockResolvedValue(refused(402, body));
    await expect(client(gatedCredentials).createCredentials({ roomId, participantId: "u-1", role: "host", ttlSeconds: 1800 })).rejects.toMatchObject({ status: 402 });
    const gatedRecording = vi.fn<typeof fetch>().mockResolvedValue(refused(402, body));
    await expect(client(gatedRecording).startRecording({ roomId, audioOnly: true })).rejects.toMatchObject({ status: 402 });
    // Reads and stops are never budget-gated by Paradise.
    const allowed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ object: "list", data: [], has_more: false, limit: 50, offset: 0 }));
    await expect(client(allowed).listRecordings({ roomId })).resolves.toEqual({ data: [], hasMore: false });
  });

  it("refuses bad credentials with the provider status and keeps provider bodies out of unreadable errors", async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(refused(401, { error: { code: "unauthenticated", message: "Missing or invalid site API key" } }));
    await expect(client(denied).verifyConnection()).rejects.toMatchObject({ status: 401 });
    const unreachable = vi.fn<typeof fetch>().mockRejectedValue(new Error("dns failure"));
    await expect(client(unreachable).verifyConnection()).rejects.toThrow("could not be reached");
    const garbage = vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(client(garbage).verifyConnection()).rejects.toThrow("unreadable or oversized");
  });

  it("verifies a connection with an authenticated room-list read", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ rooms: [room] }));
    await client(fetcher).verifyConnection();
    expect(fetcher.mock.calls[0]![0]).toBe("https://paradisemodern.com/v1/rooms");
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ unexpected: true }));
    await expect(client(invalid).verifyConnection()).rejects.toThrow("verifiable room list");
  });

  it("rejects malformed PM identities before any network call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher).endRoom("not-a-room")).rejects.toThrow("valid provider identity");
    await expect(client(fetcher).deleteRecording("not-a-recording")).rejects.toThrow("valid provider identity");
    expect(fetcher).not.toHaveBeenCalled();
    expect(ParadiseError).toBeDefined();
  });
});
