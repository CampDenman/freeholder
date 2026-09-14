// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Daily HTTP contracts composed with the contact spine and fenced leases.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createContact } from "@/core/contacts/service";
import type { getPinnedBytes } from "@/core/http/pinned-download";
import * as adapter from "../../plugins/voice-video/adapter";
import { createVoiceVideoMeetingLink, listVoiceVideoArtifacts, missVoiceVideoRoom, recordVoiceVideoArtifact, startVoiceVideoRoom, stopVoiceVideoRoom, voiceVideoRecordingAccess } from "../../plugins/voice-video/service";
import { voiceVideoRooms } from "../../plugins/voice-video/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
const SYSTEM = { kind: "system" } as const;
const providerId = randomUUID(), recordingId = randomUUID(), sessionId = randomUUID();

describe.runIf(hasDatabase)("Daily room integration", { timeout: 30_000 }, () => {
 beforeEach(async () => { await ready(); await truncateSpine(); });
 afterEach(() => vi.restoreAllMocks());
 afterAll(closeDb);
 function daily() {
  let room: { id: string; name: string; privacy: string; url: string; config: { exp: number } } | undefined;
  let transcriptReady = false;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
   const path = new URL(url as string).pathname;
   if (path === "/v1/") return Response.json({ domain_name: "freeholder-test" });
   if (path === "/v1/rooms" && init?.method === "POST") {
    const body = JSON.parse(init.body as string) as { name: string; privacy: string; properties: { exp: number } };
    room = { id: providerId, name: body.name, privacy: body.privacy, url: `https://freeholder-test.daily.co/${body.name}`, config: { exp: body.properties.exp } };
    return Response.json(room);
   }
   if (path.endsWith("/presence")) return Response.json({ total_count: 0, data: [] });
   if (path.startsWith("/v1/rooms/")) {
    if (!room) return Response.json({}, { status: 404 });
    if (init?.method === "POST") room.config.exp = (JSON.parse(init.body as string) as { properties: { exp: number } }).properties.exp;
    return Response.json(room);
   }
   if (path === "/v1/meeting-tokens") return Response.json({ token: "private-meeting-token" });
   if (path === "/v1/recordings") return Response.json({ data: [{ id: recordingId, start_ts: 100, status: "finished" }] });
   if (path === `/v1/recordings/${recordingId}`) return Response.json({ id: recordingId, room_name: room!.name, status: "finished", duration: 42, mtgSessionId: sessionId });
   if (path === `/v1/recordings/${recordingId}/access-link`) return Response.json({ download_link: "https://storage.example.test/recording?signature=secret", expires: Math.floor(Date.now() / 1000) + 60 });
   if (path === "/v1/transcript") return Response.json({ total_count: transcriptReady ? 1 : 0, data: transcriptReady ? [{ transcriptId: recordingId, roomId: providerId, mtgSessionId: sessionId, status: "t_finished", isVttAvailable: true, created_at: "2026-09-14T00:00:00Z" }] : [] });
   if (path === `/v1/transcript/${recordingId}/access-link`) return Response.json({ transcriptId: recordingId, link: "https://storage.example.test/transcript" });
   throw new Error(`Unexpected Daily path: ${path}`);
  });
  const download = vi.fn<typeof getPinnedBytes>().mockResolvedValue({ status: 200, contentType: "text/vtt", bytes: new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nReal transcript\n") });
  vi.spyOn(adapter, "voiceVideoProvider").mockReturnValue(adapter.createDailyVoiceVideoProvider({ apiKey: "private", domain: "freeholder-test.daily.co" }, fetcher, download));
  return { fetcher, readyTranscript: () => { transcriptReady = true; } };
 }
 async function input() {
  const contact = await createContact.call({ name: "Invited person", email: "daily@example.test" }, OWNER);
  return { contactId: contact.id, kind: "video" as const, provider: "daily", title: "Consultation" };
 }
 it("opens a private room, scopes host and guest tokens, ends it and refreshes a late real transcript once", async () => {
  const provider = daily(), common = await input();
  const room = await startVoiceVideoRoom.call(common, OWNER);
  expect(room.status).toBe("live");
  expect(room.conversationId).toBeTruthy();
  for (const audience of ["host", "guest"] as const) {
   const link = await createVoiceVideoMeetingLink.call({ roomId: room.id, audience }, OWNER);
   expect(link.meetingToken).toBe("private-meeting-token");
   const call = provider.fetcher.mock.calls.filter(([url]) => (url as string).endsWith("meeting-tokens")).at(-1)!;
   expect((JSON.parse(call[1]!.body as string) as { properties: Record<string, unknown> }).properties).toMatchObject({ room_name: `fh-${room.id}`, is_owner: audience === "host" });
  }
  expect((await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER)).status).toBe("ended");
  expect(await listVoiceVideoArtifacts.call({}, OWNER)).toHaveLength(0);
  await expect(createVoiceVideoMeetingLink.call({ roomId: room.id, audience: "host" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
  const artifact = await recordVoiceVideoArtifact.call({ ...common, roomId: room.id }, OWNER);
  expect(artifact).toMatchObject({ status: "recorded", transcript: null, externalRef: recordingId });
  expect(await listVoiceVideoArtifacts.call({}, OWNER)).toHaveLength(1);
  expect((await voiceVideoRecordingAccess.call({ artifactId: artifact.id }, OWNER)).downloadTokenUrl).toContain("signature=secret");
  provider.readyTranscript();
  for (let attempt = 0; attempt < 2; attempt++) await recordVoiceVideoArtifact.call({ ...common, artifactId: artifact.id, refresh: true }, OWNER);
  const artifacts = await listVoiceVideoArtifacts.call({}, OWNER);
  expect(artifacts).toHaveLength(2);
  expect(artifacts.find(row => row.kind === "transcript")!.transcript).toContain("Real transcript");
 });
 it("closes the provider before recording a missed call without inventing a recording", async () => {
  const provider = daily(), room = await startVoiceVideoRoom.call(await input(), OWNER);
  expect((await missVoiceVideoRoom.call({ roomId: room.id }, OWNER)).status).toBe("missed");
  expect(provider.fetcher.mock.calls.some(([url]) => (url as string).endsWith("/presence"))).toBe(true);
  expect(await listVoiceVideoArtifacts.call({}, OWNER)).toHaveLength(0);
 });
 it("rejects stale room results after an expired lease is reclaimed", async () => {
  const common = await input();
  const first = await getService("voiceVideo.claimStart").call(common, SYSTEM) as { roomId: string; leaseToken: string };
  await db().update(voiceVideoRooms).set({ providerLeaseExpiresAt: new Date(0) }).where(eq(voiceVideoRooms.id, first.roomId));
  const second = await getService("voiceVideo.claimStart").call({ ...common, roomId: first.roomId }, SYSTEM) as { roomId: string; leaseToken: string };
  expect(second.leaseToken).not.toBe(first.leaseToken);
  await expect(getService("voiceVideo.applyStart").call({ ...first, externalRef: `fh-${first.roomId}`, providerRoomId: providerId }, SYSTEM)).rejects.toMatchObject({ code: "conflict" });
 });
});
