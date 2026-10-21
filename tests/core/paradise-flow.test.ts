// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Paradise Comms contracts composed with the contact spine, fenced
// leases, the #394 owner-storage import pipeline and durable erasure.
// Follows tests/core/daily-flow.test.ts and tests/core/daily-import.test.ts.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createContact } from "@/core/contacts/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { getJob, stopJobs } from "@/core/jobs";
import { resetEnvForTests } from "@/core/env";
import type { getPinnedBytes } from "@/core/http/pinned-download";
import { storage } from "@/adapters/storage";
import { moduleSettings } from "@/core/settings/schema";
import * as adapter from "../../plugins/voice-video/adapter";
import { createParadiseVoiceVideoProvider } from "../../plugins/voice-video/paradise-provider";
import { eraseImportedCopies, eraseProviderRecordings } from "../../plugins/voice-video/erasure";
import {
  configureVoiceVideo,
  controlVoiceVideoRecording,
  createVoiceVideoMeetingLink,
  importVoiceVideoRecording,
  listVoiceVideoArtifacts,
  recordVoiceVideoArtifact,
  startVoiceVideoRoom,
  stopVoiceVideoRoom,
  verifyVoiceVideoConnection,
  voiceVideoRecordingAccess,
} from "../../plugins/voice-video/service";
import { voiceVideoArtifacts } from "../../plugins/voice-video/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const providerRoomId = "rm_01J8ZQ6KM2B1T0ABCDEFGHJ5K9";
const recordingId = "rec_01J8ZQ6KM2B1T0ABCDEFGHJ5K9";

/** In-memory Paradise Comms API standing in for the production host. */
function paradiseServer() {
  const created: { name?: string; policy?: string; recording?: { retention_days?: number } } = {};
  const state = {
    mediaEnded: true,
    gate402: false,
    room: {
      id: providerRoomId, name: "Consultation", owner_id: "freeholder:room",
      state: "idle", policy: "invite_only", max_participants: 20, recording_enabled: true, ended_at: null as string | null,
    },
    recording: {
      id: recordingId, object: "recording", source_type: "room", source_id: providerRoomId,
      status: "available", format: "mp4", storage_key: "comms/demo/room/f.mp4",
      playback_url: "https://bucket.nyc3.digitaloceanspaces.com/comms/demo/room/f.mp4",
      egress_id: "eg_1", duration_seconds: 42, size_bytes: 11,
      created_at: "2026-09-28T00:05:00.000Z", expires_at: null,
    },
    deleted: [] as string[],
    deleteStatus: 200,
    credentials: [] as Array<{ participant_id: string; role: string; ttl_seconds: number }>,
    startedRecording: false,
  };
  const gated = () => Response.json({ error: { code: "insufficient_balance", message: "Balance is empty",
    balance_usd: 0, top_up_url: "https://paradisemodern.com/billing/top-up" }, message: "Balance is empty" }, { status: 402 });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(url as string).pathname;
    const method = init?.method ?? "GET";
    if (state.gate402 && method === "POST" && (path === "/v1/rooms" || path.endsWith("/credentials") || path.endsWith("/recording/start"))) return gated();
    if (path === "/v1/rooms" && method === "POST") {
      const body = JSON.parse(init!.body as string) as { name: string; policy: string;
        recording: { enabled: boolean; tracks: string; retention_days?: number } };
      created.name = body.name; created.policy = body.policy; created.recording = body.recording;
      return Response.json({ ...state.room, state: "idle", name: body.name, policy: body.policy }, { status: 201 });
    }
    if (path === `/v1/rooms/${providerRoomId}` && method === "GET") return Response.json(state.room);
    if (path === `/v1/rooms/${providerRoomId}/credentials` && method === "POST") {
      if (state.room.state === "ended") return Response.json({ error: { code: "room_ended", message: "Room is in terminal state 'ended'" } }, { status: 409 });
      const body = JSON.parse(init!.body as string) as { participant_id: string; role: string; ttl_seconds: number };
      state.credentials.push(body);
      return Response.json({ room_id: providerRoomId, participant_id: body.participant_id, role: body.role,
        livekit_url: "wss://livekit.example.test", token: `jwt-${body.role}-${body.participant_id}`,
        ice_servers: [{ urls: ["stun:turn.example.test:3478"] }], expires_at: "2026-09-28T01:00:00.000Z" });
    }
    if (path === `/v1/rooms/${providerRoomId}/end` && method === "POST") {
      if (!state.mediaEnded) {
        return Response.json({ ...state.room, media_ended: false, error: { code: "media_termination_pending",
          message: "Room closed; media shutdown is pending. Retry this request." } }, { status: 503 });
      }
      state.room = { ...state.room, state: "ended", ended_at: "2026-09-28T00:05:00.000Z" };
      return Response.json({ ...state.room, media_ended: true });
    }
    if (path === `/v1/rooms/${providerRoomId}/recording/start` && method === "POST") {
      state.startedRecording = true;
      return Response.json({ ...state.recording, status: "active" }, { status: 201 });
    }
    if (path === `/v1/rooms/${providerRoomId}/recording/stop` && method === "POST") {
      if (!state.startedRecording) return Response.json({ ok: true, message: "No active recording." });
      state.startedRecording = false;
      return Response.json({ ...state.recording, status: "stopping" });
    }
    if (path === "/v1/recordings" && method === "GET") {
      const rows = state.deleted.includes(state.recording.id) ? [] : [state.recording];
      return Response.json({ object: "list", data: rows, has_more: false, limit: 50, offset: 0 });
    }
    if (path === `/v1/recordings/${recordingId}` && method === "GET") {
      if (state.deleted.includes(recordingId)) return Response.json({ error: { code: "recording_not_found" } }, { status: 404 });
      return Response.json(state.recording);
    }
    if (path === `/v1/recordings/${recordingId}` && method === "DELETE") {
      if (state.deleteStatus !== 200) {
        const status = state.deleteStatus;
        return Response.json({ error: { code: status === 409 ? "recording_not_finished" : "recording_delete_failed",
          message: status === 409 ? "Stop the egress first" : "Spaces unavailable", retryable: status === 503 } }, { status });
      }
      state.deleted.push(recordingId);
      return Response.json({ id: recordingId, object: "recording", deleted: true });
    }
    if (path === "/v1/rooms" && method === "GET") return Response.json({ rooms: [state.room] });
    throw new Error(`Unexpected Paradise path: ${method} ${path}`);
  });
  const download = vi.fn<typeof getPinnedBytes>().mockResolvedValue({ status: 200, contentType: "video/mp4", bytes: new TextEncoder().encode("paradise bytes") });
  const provider = () => createParadiseVoiceVideoProvider({
    baseUrl: "https://paradisemodern.com/v1", authScheme: "site_key", apiKey: "pm-key", portfolioToken: null,
    webhookSecret: null, roomPolicy: "invite_only", retentionDays: 14,
  }, fetcher, download);
  return { fetcher, download, provider, state, created };
}

async function input(title = "Consultation") {
  const contact = await createContact.call({ name: "Invited person", email: `${randomUUID()}@example.test` }, OWNER);
  return { contactId: contact.id, kind: "video" as const, provider: "paradise", title };
}

const jobContext = (id: string) => ({ id, name: "job", attempt: 1, signal: new AbortController().signal,
  leaseSeconds: 300, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} });

async function runErasureJobs(requestId: string) {
  const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
  const body = artifact?.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> } | undefined;
  expect(body).toBeTruthy();
  for (const outcome of body!.outcomes) {
    for (const jobId of outcome.pendingJobs ?? []) {
      const storageJob = await getJob(eraseImportedCopies.name, jobId);
      if (storageJob) { await eraseImportedCopies.handler(storageJob.data, jobContext(jobId)); continue; }
      const providerJob = await getJob(eraseProviderRecordings.name, jobId);
      if (!providerJob) throw new Error(`Unknown erasure job ${jobId}`);
      await eraseProviderRecordings.handler(providerJob.data, jobContext(jobId));
    }
  }
  const [after] = await db().select().from(dataRequests).where(eq(dataRequests.id, requestId));
  return after!;
}

describe.runIf(hasDatabase)("Paradise Comms room integration", { timeout: 60_000 }, () => {
  beforeEach(async () => { await ready(); await truncateSpine(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetEnvForTests();
    vi.unstubAllGlobals();
    const artifacts = await db().select().from(voiceVideoArtifacts);
    for (const artifact of artifacts) {
      for (const key of [artifact.storageKey, artifact.transcriptStorageKey]) {
        if (key) await storage().delete(key).catch(() => undefined);
      }
    }
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("opens an owner-named invite-only room, issues LiveKit credentials, ends provider-confirmed and imports the recording without a transcript", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const common = await input();
    const room = await startVoiceVideoRoom.call(common, OWNER);
    expect(room.status).toBe("live");
    expect(room.externalRef).toBe(providerRoomId);
    expect(room.providerRoomId).toBeNull();
    expect(pm.created).toMatchObject({ name: "Consultation", policy: "invite_only", recording: { retention_days: 14 } });
    expect(pm.fetcher.mock.calls[0]![1]!.headers).toMatchObject({ "Idempotency-Key": "Consultation" });

    for (const audience of ["host", "guest"] as const) {
      const link = await createVoiceVideoMeetingLink.call({ roomId: room.id, audience }, OWNER);
      expect(link.meetingToken).toBe(`jwt-${audience === "host" ? "host" : "participant"}-${audience === "host" ? OWNER.userId : room.contactId}`);
      expect(link.livekitUrl).toBe("wss://livekit.example.test");
      expect(link.iceServers).toEqual([{ urls: ["stun:turn.example.test:3478"] }]);
    }
    expect(pm.state.credentials.map((row) => row.role)).toEqual(["host", "participant"]);
    expect(pm.state.credentials[0]!.ttl_seconds).toBe(1800);

    expect((await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER)).status).toBe("ended");
    const artifact = await recordVoiceVideoArtifact.call({ ...common, roomId: room.id }, OWNER);
    expect(artifact).toMatchObject({ status: "recorded", transcript: null, externalRef: recordingId, importStatus: "imported" });
    expect(await listVoiceVideoArtifacts.call({}, OWNER)).toHaveLength(1);
    expect((await voiceVideoRecordingAccess.call({ artifactId: artifact.id }, OWNER)).downloadTokenUrl)
      .toBe("https://bucket.nyc3.digitaloceanspaces.com/comms/demo/room/f.mp4");
    expect(pm.download).toHaveBeenCalledWith("https://bucket.nyc3.digitalocenspaces.com/comms/demo/room/f.mp4".replace("ocenspaces", "oceanspaces"),
      { maxBytes: 512 * 1024 * 1024, timeoutMs: 60000 });
  });

  it("fails closed on media_termination_pending and ends the room on the retry", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const room = await startVoiceVideoRoom.call(await input(), OWNER);
    pm.state.mediaEnded = false;
    const failed = await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toContain("media shutdown is pending");
    pm.state.mediaEnded = true;
    expect((await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER)).status).toBe("ended");
  });

  it("refuses rooms from the other provider instead of crossing the seam", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const contact = await createContact.call({ name: "Daily person", email: `${randomUUID()}@example.test` }, OWNER);
    const room = await startVoiceVideoRoom.call({ contactId: contact.id, kind: "voice", provider: "daily", title: "Legacy call" }, OWNER);
    expect(room.status).toBe("failed");
    expect(room.lastError).toContain("other call provider");
  });

  it("selects paradise from stored settings and keeps env-only Daily instances on Daily", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await configureVoiceVideo.call({ provider: "paradise", paradise: { apiKey: "pm-key" } }, OWNER);
      const paradise = await adapter.voiceVideoProvider();
      expect(typeof paradise.startRecording).toBe("function");
      vi.stubEnv("DAILY_API_KEY", "daily-key");
      vi.stubEnv("DAILY_DOMAIN", "example.daily.co");
      resetEnvForTests();
      await configureVoiceVideo.call({ provider: "daily" }, OWNER);
      const daily = await adapter.voiceVideoProvider();
      expect("startRecording" in daily).toBe(false);
      // The pre-pivot env-only configuration keeps working: no stored row,
      // Daily credentials in the environment, Daily provider selected.
      await db().delete(moduleSettings).where(eq(moduleSettings.module, "voice-video"));
      const legacy = await adapter.voiceVideoProvider();
      expect("startRecording" in legacy).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      resetEnvForTests();
    }
  });

  it("surfaces the 402 prepaid gate with the top-up link on the room and the verify probe", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    pm.state.gate402 = true;
    const room = await startVoiceVideoRoom.call(await input(), OWNER);
    expect(room.status).toBe("failed");
    expect(room.lastError).toContain("Top up at https://paradisemodern.com/billing/top-up");

    // The probe builds its own client from the saved settings; both answers
    // are mocked HTTP, never the production host.
    await configureVoiceVideo.call({ provider: "paradise", paradise: { apiKey: "pm-key" } }, OWNER);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ rooms: [] })));
    const probe = await verifyVoiceVideoConnection.call({}, OWNER);
    expect(probe).toMatchObject({ ok: true, status: 200 });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "insufficient_balance",
      message: "Balance is empty", balance_usd: 0, top_up_url: "https://paradisemodern.com/billing/top-up" }, message: "Balance is empty" }, { status: 402 })));
    const refused = await verifyVoiceVideoConnection.call({}, OWNER);
    expect(refused).toMatchObject({ ok: false, status: 402, balanceUsd: 0, topUpUrl: "https://paradisemodern.com/billing/top-up" });
  });

  it("starts and stops recording on a live room through the provider seam", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const room = await startVoiceVideoRoom.call(await input("Recorded call"), OWNER);
    const started = await controlVoiceVideoRecording.call({ roomId: room.id, action: "start" }, OWNER);
    expect(started).toMatchObject({ providerRecordingId: recordingId, status: "active" });
    expect(pm.state.startedRecording).toBe(true);
    const stopped = await controlVoiceVideoRecording.call({ roomId: room.id, action: "stop" }, OWNER);
    expect(stopped).toMatchObject({ providerRecordingId: recordingId, status: "stopping" });
  });

  it("erases PM recordings for an erased contact only after PM confirms deletion", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const common = await input();
    const room = await startVoiceVideoRoom.call(common, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    const artifact = await recordVoiceVideoArtifact.call({ ...common, roomId: room.id }, OWNER);
    expect(artifact.importStatus).toBe("imported");

    const request = await createDataRequest.call({ contactId: common.contactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Verified customer request" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    expect(await db().select().from(voiceVideoArtifacts)).toHaveLength(0);
    const after = await runErasureJobs(request.id);
    expect(after.status).toBe("completed");
    expect(pm.state.deleted).toEqual([recordingId]);
  });

  it("keeps erasure pending while PM retains the row on a 503, then completes on retry", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const common = await input();
    const room = await startVoiceVideoRoom.call(common, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    await recordVoiceVideoArtifact.call({ ...common, roomId: room.id }, OWNER);

    const request = await createDataRequest.call({ contactId: common.contactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Verified customer request" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    pm.state.deleteStatus = 503;
    await expect(runErasureJobs(request.id)).rejects.toMatchObject({ status: 503 });
    const [pending] = await db().select().from(dataRequests).where(eq(dataRequests.id, request.id));
    expect(pending!.status).toBe("in_progress");
    pm.state.deleteStatus = 200;
    const after = await runErasureJobs(request.id);
    expect(after.status).toBe("completed");
    expect(pm.state.deleted).toEqual([recordingId]);
  });

  it("waits out mid-egress recordings and refuses to delete them mid-flight", async () => {
    const pm = paradiseServer();
    vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const common = await input();
    const room = await startVoiceVideoRoom.call(common, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    await recordVoiceVideoArtifact.call({ ...common, roomId: room.id }, OWNER);

    const request = await createDataRequest.call({ contactId: common.contactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Verified customer request" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    // Mid-egress: the provider stops the egress and asks the durable job to
    // retry instead of DELETEing into a running multipart upload.
    pm.state.recording = { ...pm.state.recording, status: "processing" };
    await expect(runErasureJobs(request.id)).rejects.toThrow("still processing");
    expect(pm.state.deleted).toEqual([]);
    pm.state.recording = { ...pm.state.recording, status: "available" };
    const after = await runErasureJobs(request.id);
    expect(after.status).toBe("completed");
    expect(pm.state.deleted).toEqual([recordingId]);
  });

  it("retries a failed owner-storage import in place with content-addressed keys", async () => {
    const pm = paradiseServer();
    const spy = vi.spyOn(adapter, "voiceVideoProvider").mockResolvedValue(pm.provider());
    const common = await input();
    const room = await startVoiceVideoRoom.call(common, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    pm.download.mockRejectedValueOnce(new Error("Storage copy failed"));
    const artifact = await recordVoiceVideoArtifact.call({ ...common, roomId: room.id }, OWNER);
    expect(artifact.importStatus).toBe("failed");
    expect(artifact.importError).toContain("could not be downloaded safely");
    const retried = await importVoiceVideoRecording.call({ artifactId: artifact.id }, OWNER);
    expect(retried).toMatchObject({ importStatus: "imported", importError: null });
    expect(spy).toHaveBeenCalled();
  });
});
