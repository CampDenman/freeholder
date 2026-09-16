// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: private Daily room and recording contracts without live calls.
import { describe, expect, it, vi } from "vitest";
import type { getPinnedBytes } from "@/core/http/pinned-download";
import { createDailyClient } from "../../plugins/voice-video/daily";
const config = { apiKey: "private-daily-key", domain: "example.daily.co" };
const id = "11111111-1111-4111-8111-111111111111";
const providerId = "22222222-2222-4222-8222-222222222222";
const participantId = "33333333-3333-4333-8333-333333333333";
const recordingId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const now = Date.UTC(2026, 8, 13);
const expiresAt = Math.floor(now / 1000) + 3600;
const name = `fh-${id}`;
const reference = `${config.domain}/${name}`;
const room = { id: providerId, name, privacy: "private", url: `https://${reference}`, config: { exp: expiresAt } };
const missing = () => Response.json({ error: "not-found" }, { status: 404 });
const client = (fetcher: typeof fetch) => createDailyClient(config, fetcher, () => now);

describe("Daily live client", () => {
 it("creates a private expiring room with devices off and recovers the same name on retry", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json(room)).mockResolvedValueOnce(Response.json(room));
  const provider = client(fetcher);
  const created = await provider.ensureRoom({ roomId: id, kind: "video", expiresAt });
  expect(created).toMatchObject({ providerRoomId: providerId, externalRef: reference, expiresAt });
  await provider.ensureRoom({ roomId: id, kind: "video", expiresAt });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  const request = fetcher.mock.calls[1]![1]!;
  expect(request).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer private-daily-key" } });
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(request.body as string)).toMatchObject({ name, privacy: "private", properties: { exp: expiresAt, start_audio_off: true, start_video_off: true, eject_at_room_exp: true } });
 });
 it("recovers a room after its creation response is lost", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(missing()).mockRejectedValueOnce(new Error("connection lost after creation")).mockResolvedValueOnce(Response.json(room));
  expect((await client(fetcher).ensureRoom({ roomId: id, kind: "voice", expiresAt })).externalRef).toBe(reference);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
 });
 it("refuses public rooms, wrong domains and expired create requests", async () => {
  for (const invalid of [{ ...room, privacy: "public" }, { ...room, url: `https://other.daily.co/${name}` }]) {
   const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(invalid));
   await expect(client(fetcher).ensureRoom({ roomId: id, kind: "video", expiresAt })).rejects.toThrow();
   expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher = vi.fn<typeof fetch>();
  await expect(client(fetcher).ensureRoom({ roomId: id, kind: "voice", expiresAt: 1 })).rejects.toThrow("expired");
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("issues tokens for exactly one room and keeps the credential separate from the URL", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(room)).mockResolvedValueOnce(Response.json({ token: "private-meeting-token" }));
  const result = await client(fetcher).createMeetingToken({ externalRef: reference, providerRoomId: providerId, userId: id, userName: "Host", owner: true });
  expect(result).toEqual({ roomUrl: room.url, meetingToken: "private-meeting-token", expiresAt: Math.floor(now / 1000) + 1800 });
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({ properties: { room_name: name, is_owner: true, user_id: id, exp: result.expiresAt } });
 });
 it("expires a room, ejects its participants and checks that none remain", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(room)).mockResolvedValueOnce(Response.json(room))
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ id: participantId, room: name }] }))
   .mockResolvedValueOnce(Response.json({ ejectedIds: [participantId] }))
   .mockResolvedValueOnce(Response.json({ total_count: 0, data: [] }));
  await client(fetcher).endRoom({ externalRef: reference, providerRoomId: providerId });
  expect(JSON.parse(fetcher.mock.calls[3]![1]!.body as string)).toEqual({ ids: [participantId] });
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
 });
 it("does not claim a call ended when participants remain or the room is missing", async () => {
  const present = { total_count: 1, data: [{ id: participantId, room: name }] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(room)).mockResolvedValueOnce(Response.json(room))
   .mockResolvedValueOnce(Response.json(present)).mockResolvedValueOnce(Response.json({ ejectedIds: [] })).mockResolvedValueOnce(Response.json(present));
  await expect(client(fetcher).endRoom({ externalRef: reference, providerRoomId: providerId })).rejects.toThrow("still ending");
  await expect(client(vi.fn<typeof fetch>().mockResolvedValue(missing())).endRoom({ externalRef: reference, providerRoomId: providerId })).rejects.toThrow("cannot verify");
 });
 it("verifies a finished recording belongs to the expected room", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: recordingId, start_ts: 100, status: "finished" }] }))
   .mockResolvedValueOnce(Response.json({ id: recordingId, room_name: name, status: "finished", duration: 42, mtgSessionId: sessionId }));
  expect(await client(fetcher).findRecording({ externalRef: reference })).toEqual({ id: recordingId, roomName: name, durationSeconds: 42, meetingSessionId: sessionId });
  const wrong = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: recordingId, room_name: "other", status: "finished", duration: 42, mtgSessionId: sessionId }));
  await expect(client(wrong).findRecording({ externalRef: reference, recordingId })).rejects.toThrow("has not verified");
 });
 it("keeps pending recordings pending and provider bodies out of errors", async () => {
  const pending = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: recordingId, start_ts: 100, status: "in-progress" }] }));
  await expect(client(pending).findRecording({ externalRef: reference })).rejects.toThrow("not ready");
  const denied = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: config.apiKey }, { status: 401 }));
  await expect(client(denied).ensureRoom({ roomId: id, kind: "voice", expiresAt })).rejects.toThrow("Daily refused the request (HTTP 401).");
 });
 it("downloads verified WebVTT with a bounded credential-free storage request", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ total_count: 1, data: [{
   transcriptId: recordingId, roomId: providerId, mtgSessionId: sessionId, status: "t_finished", isVttAvailable: true, created_at: "2026-09-13T10:00:00Z",
  }] })).mockResolvedValueOnce(Response.json({ transcriptId: recordingId, link: "https://storage.example.test/transcript?signature=private" }));
  const vtt = "WEBVTT\n\n00:00.000 --> 00:01.000\nActual spoken words\n";
  const download = vi.fn<typeof getPinnedBytes>().mockResolvedValue({ status: 200, contentType: "text/vtt", bytes: new TextEncoder().encode(vtt) });
  const provider = createDailyClient(config, fetcher, () => now, download);
  expect(await provider.readTranscript({ providerRoomId: providerId, meetingSessionId: sessionId })).toBe(vtt);
  expect(download).toHaveBeenCalledWith("https://storage.example.test/transcript?signature=private", { maxBytes: 100000, timeoutMs: 20000 });
 });
 it("returns no invented transcript while processing and refuses another room's transcript", async () => {
  const metadata = { transcriptId: recordingId, roomId: providerId, mtgSessionId: sessionId, status: "t_in_progress", isVttAvailable: false, created_at: "2026-09-13T10:00:00Z" };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ total_count: 1, data: [metadata] })).mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ ...metadata, roomId: id }] }));
  const download = vi.fn<typeof getPinnedBytes>();
  const provider = createDailyClient(config, fetcher, () => now, download);
  expect(await provider.readTranscript({ providerRoomId: providerId, meetingSessionId: sessionId })).toBeNull();
  await expect(provider.readTranscript({ providerRoomId: providerId, meetingSessionId: sessionId })).rejects.toThrow("complete transcript metadata");
  expect(download).not.toHaveBeenCalled();
 });

 it("rejects credentials for another Daily domain", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ domain_name: "example" })).mockResolvedValueOnce(Response.json({ domain_name: "other" }));
  await client(fetcher).verifyDomain();
  await expect(client(fetcher).verifyDomain()).rejects.toThrow("different domain");
 });
 it("returns only unexpired HTTPS recording download capabilities", async () => {
  const credentialUrl = new URL("https://storage.example.test/file");
  credentialUrl.username = "fixture-user";
  credentialUrl.password = "fixture-password";
  for (const download_link of ["http://storage.example.test/file", credentialUrl.href]) {
   const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ download_link, expires: Math.floor(now / 1000) + 60 }));
   await expect(client(fetcher).recordingAccess(recordingId)).rejects.toThrow("unsafe");
  }
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ download_link: "https://storage.example.test/file", expires: 1 }));
  await expect(client(fetcher).recordingAccess(recordingId)).rejects.toThrow("valid recording download");
 });

 it("erases verified recordings and transcripts and verifies the resulting inventory", async () => {
  const empty = { total_count: 0, data: [] };
  const transcript = { transcriptId: sessionId, roomId: providerId, status: "t_finished" };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(missing())
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ id: recordingId }] }))
   .mockResolvedValueOnce(Response.json({ id: recordingId, room_name: name, status: "finished" }))
   .mockResolvedValueOnce(Response.json({ id: recordingId, deleted: true }))
   .mockResolvedValueOnce(Response.json(empty))
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [transcript] }))
   .mockResolvedValueOnce(Response.json({ ...transcript, status: "t_deleted" }))
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ ...transcript, status: "t_deleted" }] }));
  await client(fetcher).eraseRoomRecordings({ externalRef: reference, providerRoomId: providerId });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => url)).toEqual([
   `https://api.daily.co/v1/recordings/${recordingId}`, `https://api.daily.co/v1/transcript/${sessionId}`,
  ]);
 });
 it("refuses to erase another room's recording or confirm incomplete deletion", async () => {
  const wrong = vi.fn<typeof fetch>().mockResolvedValueOnce(missing())
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ id: recordingId }] }))
   .mockResolvedValueOnce(Response.json({ id: recordingId, room_name: "other-room", status: "finished" }));
  await expect(client(wrong).eraseRoomRecordings({ externalRef: reference, providerRoomId: providerId })).rejects.toThrow("for erasure from this room");
  expect(wrong.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  const remains = vi.fn<typeof fetch>().mockResolvedValueOnce(missing())
   .mockResolvedValueOnce(Response.json({ total_count: 0, data: [] }))
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ id: recordingId }] }));
  await expect(client(remains).eraseRoomRecordings({ externalRef: reference, providerRoomId: providerId })).rejects.toThrow("remains pending");
 });
 it("recovers a lost delete response from absent records and refuses an unknown room identity", async () => {
  const empty = { total_count: 0, data: [] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(missing())
   .mockResolvedValueOnce(Response.json({ total_count: 1, data: [{ id: recordingId }] }))
   .mockResolvedValueOnce(missing()).mockImplementation(async () => Response.json(empty));
  await client(fetcher).eraseRoomRecordings({ externalRef: reference, providerRoomId: providerId });
  await expect(client(vi.fn<typeof fetch>().mockResolvedValue(missing())).eraseRoomRecordings({ externalRef: reference, providerRoomId: null })).rejects.toThrow("original room identity");
 });
 it("walks transcript pages including deleted entries and rejects repeated pagination", async () => {
  const empty = { total_count: 0, data: [] };
  const first = { total_count: 2, data: [{ transcriptId: recordingId, roomId: providerId, status: "t_deleted" }] };
  const second = { total_count: 2, data: [{ transcriptId: sessionId, roomId: providerId, status: "t_deleted" }] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json(empty))
   .mockResolvedValueOnce(Response.json(empty)).mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second))
   .mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second));
  await client(fetcher).eraseRoomRecordings({ externalRef: reference, providerRoomId: providerId });
  expect(fetcher.mock.calls[4]?.[0]).toContain(`starting_after=${recordingId}`);
  const repeated = vi.fn<typeof fetch>().mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json(empty))
   .mockResolvedValueOnce(Response.json(empty)).mockImplementation(async () => Response.json(first));
  await expect(client(repeated).eraseRoomRecordings({ externalRef: reference, providerRoomId: providerId })).rejects.toThrow("repeated transcript");
 });

});
