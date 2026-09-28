// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Paradise Comms room, credential, recording and erasure lifecycle.
// Contract: docs/site-comms-api.md §7.1 in the paradisemodern tree,
// 2026-09-28.comms-recording-lifecycle. Base https://paradisemodern.com/v1.
import { z } from "zod";
import { getPinnedBytes } from "@/core/http/pinned-download";
import { readBoundedBytes } from "@/core/http/body";

export type ParadiseAuthScheme = "site_key" | "portfolio_token";
export interface ParadiseConfiguration {
  baseUrl: string;
  authScheme: ParadiseAuthScheme;
  /** Per-site key (canonical). Exactly one of the two credentials is set. */
  apiKey: string | null;
  /** Legacy portfolio bearer token; never budget-gated by Paradise. */
  portfolioToken: string | null;
}

export class ParadiseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly balanceUsd?: number,
    readonly topUpUrl?: string,
  ) {
    super(message);
    this.name = "ParadiseError";
  }
}

// Recordings download whole into memory before storage puts them, so the
// bound is a hard product limit, not a transport preference. Same 512 MiB
// ceiling as the Daily path; a recording above it fails import visibly
// instead of exhausting the worker.
export const PARADISE_RECORDING_MAX_BYTES = 512 * 1024 * 1024;

const roomIdSchema = z.string().regex(/^rm_[0-9A-Z]{26}$/);
const recordingIdSchema = z.string().regex(/^rec_[0-9A-Z]{26}$/);

const isoDate = z.string().max(40);

export const paradiseRoomSchema = z.object({
  id: roomIdSchema,
  name: z.string().min(1).max(200),
  owner_id: z.string().min(1).max(128),
  state: z.enum(["idle", "live", "ended", "error"]),
  policy: z.enum(["open", "moderated", "invite_only"]),
  max_participants: z.number().int().min(2).max(100),
  recording_enabled: z.boolean(),
  ended_at: isoDate.nullable().optional(),
  created_at: isoDate.optional(),
});
export type ParadiseRoom = z.infer<typeof paradiseRoomSchema>;

const iceServerSchema = z.object({
  urls: z.array(z.string().max(500)).min(1).max(8),
  username: z.string().max(500).optional(),
  credential: z.string().max(500).optional(),
});

const credentialsSchema = z.object({
  room_id: roomIdSchema,
  participant_id: z.string().min(1).max(128),
  role: z.string().min(1).max(32),
  livekit_url: z.string().min(1).max(500),
  token: z.string().min(1).max(16_384),
  ice_servers: z.array(iceServerSchema).max(8),
  expires_at: isoDate,
});
export type ParadiseCredentials = z.infer<typeof credentialsSchema>;

export const paradiseRecordingSchema = z.object({
  id: recordingIdSchema,
  object: z.literal("recording").optional(),
  source_type: z.enum(["stream", "room", "call"]),
  source_id: z.string().min(1).max(64),
  status: z.enum(["active", "stopping", "processing", "available", "failed", "deleting", "expired"]),
  format: z.string().max(16).nullable().optional(),
  storage_key: z.string().max(600).nullable().optional(),
  playback_url: z.string().max(4000).nullable().optional(),
  egress_id: z.string().max(128).nullable().optional(),
  duration_seconds: z.number().int().nonnegative().nullable().optional(),
  size_bytes: z.number().int().nonnegative().nullable().optional(),
  created_at: isoDate.nullable().optional(),
  expires_at: isoDate.nullable().optional(),
});
export type ParadiseRecording = z.infer<typeof paradiseRecordingSchema>;

const recordingListSchema = z.object({
  object: z.literal("list"),
  data: z.array(paradiseRecordingSchema).max(50),
  has_more: z.boolean(),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().nonnegative(),
});

const errorBodySchema = z.object({
  error: z.object({
    code: z.string().max(100).optional(),
    message: z.string().max(500).optional(),
    balance_usd: z.number().optional(),
    top_up_url: z.string().url().max(2000).optional(),
  }).optional(),
  message: z.string().max(500).optional(),
});

interface RequestOptions {
  /** Deterministic recovery of a create whose response was lost. */
  idempotencyKey?: string;
}

export function createParadiseClient(
  configuration: ParadiseConfiguration,
  fetcher: typeof fetch = fetch,
  now = Date.now,
  download: typeof getPinnedBytes = getPinnedBytes,
) {
  const baseUrl = configuration.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(baseUrl)) {
    throw new ParadiseError("Configure a valid https Paradise Comms base URL before opening rooms.");
  }
  const credential = configuration.authScheme === "site_key" ? configuration.apiKey : configuration.portfolioToken;
  if (!credential || /[\r\n]/.test(credential)) {
    throw new ParadiseError(
      configuration.authScheme === "site_key"
        ? "Configure a Paradise Comms site API key before opening rooms."
        : "Configure a Paradise Comms portfolio token before opening rooms.",
    );
  }
  const headers = (): Record<string, string> => {
    const base = { "Content-Type": "application/json" };
    return configuration.authScheme === "site_key"
      ? { ...base, "x-api-key": credential }
      : { ...base, Authorization: `Bearer ${credential}` };
  };

  async function request(path: string, method = "GET", body?: unknown, options: RequestOptions = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, { method,
        headers: { ...headers(), ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(20_000) });
    } catch { throw new ParadiseError("Paradise Comms could not be reached. Retry the same room operation."); }
    if (!response.ok) {
      let parsed: z.infer<typeof errorBodySchema> | undefined;
      try {
        parsed = errorBodySchema.parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 65_536))));
      } catch { parsed = undefined; }
      const detail = parsed?.error ?? {};
      const code = detail.code;
      const message = detail.message ?? parsed?.message;
      if (response.status === 402) {
        // The prepaid gate is a business fact, not a transport failure: name
        // the balance and the top-up link so every surface can show them.
        const balance = detail.balance_usd;
        const topUp = detail.top_up_url;
        throw new ParadiseError(
          `Paradise Comms prepaid balance is empty${balance !== undefined ? ` ($${String(balance)} remaining)` : ""}. Top up at ${topUp ?? "the Paradise Modern dashboard"}.`,
          402, code, balance, topUp,
        );
      }
      throw new ParadiseError(
        `Paradise Comms refused the request (HTTP ${response.status})${message ? `: ${message}` : code ? ` [${code}]` : "."}`,
        response.status, code,
      );
    }
    if (response.status === 204) return null;
    try { return JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 1_048_576))) as unknown; }
    catch { throw new ParadiseError("Paradise Comms returned an unreadable or oversized response."); }
  }

  function validateRoom(value: unknown, name: string): ParadiseRoom {
    const result = paradiseRoomSchema.safeParse(value);
    if (!result.success || result.data.name !== name) {
      throw new ParadiseError("Paradise Comms did not verify this room's identity and policy.");
    }
    return result.data;
  }

  async function readRoomById(id: string): Promise<ParadiseRoom | null> {
    if (!roomIdSchema.safeParse(id).success) throw new ParadiseError("This room has no valid provider identity.");
    const response = await request(`/rooms/${id}`, "GET", undefined, {});
    return response === null ? null : paradiseRoomSchema.parse(response);
  }

  function validatePlaybackUrl(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new ParadiseError("Paradise Comms returned an unsafe recording playback URL.");
    }
    return url.href;
  }

  return {
    async verifyConnection(): Promise<void> {
      // The cheapest authenticated read: a site key with rooms.read scope
      // answers 200. 401 means a bad key; 402 cannot occur on reads.
      const parsed = z.object({ rooms: z.array(z.unknown()) }).safeParse(await request("/rooms"));
      if (!parsed.success) throw new ParadiseError("Paradise Comms did not return a verifiable room list.");
    },

    async readRoom(id: string): Promise<ParadiseRoom | null> { return readRoomById(id); },

    async createRoom(input: { name: string; ownerId: string; policy: "open" | "moderated" | "invite_only";
      maxParticipants: number; recordingEnabled: boolean; retentionDays: number | null }): Promise<ParadiseRoom> {
      if (!input.name.trim() || input.name.length > 200 || !input.ownerId.trim() || input.ownerId.length > 128) {
        throw new ParadiseError("Supply a valid room name and owner identity.");
      }
      const created = await request("/rooms", "POST", {
        name: input.name, owner_id: input.ownerId, policy: input.policy,
        max_participants: input.maxParticipants, max_publishers: input.maxParticipants,
        recording: input.recordingEnabled
          ? { enabled: true, tracks: "composite_only", ...(input.retentionDays ? { retention_days: input.retentionDays } : {}) }
          : { enabled: false },
        metadata: { source: "freeholder" },
      }, { idempotencyKey: input.name });
      return validateRoom(created, input.name);
    },

    async createCredentials(input: { roomId: string; participantId: string; role: "host" | "participant";
      ttlSeconds: number }): Promise<ParadiseCredentials> {
      if (!roomIdSchema.safeParse(input.roomId).success) throw new ParadiseError("This room has no valid provider identity.");
      if (!input.participantId.trim() || input.participantId.length > 128) throw new ParadiseError("Supply a valid participant identity.");
      if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 14_400) {
        throw new ParadiseError("This credential request has expired. Create a new room.");
      }
      const parsed = credentialsSchema.safeParse(await request(`/rooms/${input.roomId}/credentials`, "POST", {
        participant_id: input.participantId, role: input.role, ttl_seconds: input.ttlSeconds,
      }));
      if (!parsed.success || parsed.data.room_id !== input.roomId || parsed.data.participant_id !== input.participantId) {
        throw new ParadiseError("Paradise Comms did not verify these room credentials.");
      }
      return parsed.data;
    },

    async endRoom(id: string): Promise<void> {
      if (!roomIdSchema.safeParse(id).success) throw new ParadiseError("This room has no valid provider identity.");
      const parsed = z.object({ id: roomIdSchema, state: z.string(), media_ended: z.boolean().optional(),
        error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional() })
        .safeParse(await request(`/rooms/${id}/end`, "POST", {}));
      if (!parsed.success || parsed.data.id !== id) throw new ParadiseError("Paradise Comms did not confirm this room's identity.");
      // Provider-confirmed end is the only proof the call's media stopped; a
      // 503 media_termination_pending stays retryable and fail-closed.
      if (parsed.data.media_ended !== true) {
        throw new ParadiseError(parsed.data.error?.message ?? "Paradise Comms is still ending this call's media. Retry shortly.");
      }
    },

    async startRecording(input: { roomId: string; audioOnly: boolean }): Promise<ParadiseRecording> {
      if (!roomIdSchema.safeParse(input.roomId).success) throw new ParadiseError("This room has no valid provider identity.");
      const parsed = paradiseRecordingSchema.safeParse(
        await request(`/rooms/${input.roomId}/recording/start`, "POST", { audio_only: input.audioOnly }));
      if (!parsed.success || parsed.data.source_id !== input.roomId) {
        throw new ParadiseError("Paradise Comms did not verify this recording.");
      }
      return parsed.data;
    },

    async stopRecording(roomId: string): Promise<ParadiseRecording | null> {
      if (!roomIdSchema.safeParse(roomId).success) throw new ParadiseError("This room has no valid provider identity.");
      const response = await request(`/rooms/${roomId}/recording/stop`, "POST", {});
      const empty = z.object({ ok: z.boolean() }).safeParse(response);
      if (empty.success) return null; // No active recording — already stopped.
      const parsed = paradiseRecordingSchema.safeParse(response);
      if (!parsed.success || parsed.data.source_id !== roomId) {
        throw new ParadiseError("Paradise Comms did not verify this recording.");
      }
      return parsed.data;
    },

    async listRecordings(input: { roomId: string; status?: string; limit?: number; offset?: number }): Promise<{ data: ParadiseRecording[]; hasMore: boolean }> {
      if (!roomIdSchema.safeParse(input.roomId).success) throw new ParadiseError("This room has no valid provider identity.");
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
      const offset = Math.max(input.offset ?? 0, 0);
      const status = input.status ? `&status=${encodeURIComponent(input.status)}` : "";
      const parsed = recordingListSchema.safeParse(
        await request(`/recordings?room_id=${encodeURIComponent(input.roomId)}${status}&limit=${limit}&offset=${offset}`));
      if (!parsed.success || parsed.data.data.some((item) => item.source_type !== "room" || item.source_id !== input.roomId)) {
        throw new ParadiseError("Paradise Comms did not return a complete recording list for this room.");
      }
      return { data: parsed.data.data, hasMore: parsed.data.has_more };
    },

    async readRecording(id: string): Promise<ParadiseRecording> {
      if (!recordingIdSchema.safeParse(id).success) throw new ParadiseError("This recording has no valid provider identity.");
      const parsed = paradiseRecordingSchema.safeParse(await request(`/recordings/${id}`));
      if (!parsed.success || parsed.data.id !== id) throw new ParadiseError("Paradise Comms did not verify this recording.");
      return parsed.data;
    },

    async deleteRecording(id: string): Promise<void> {
      if (!recordingIdSchema.safeParse(id).success) throw new ParadiseError("This recording has no valid provider identity.");
      const parsed = z.object({ id: recordingIdSchema, deleted: z.literal(true) })
        .safeParse(await request(`/recordings/${id}`, "DELETE"));
      if (!parsed.success || parsed.data.id !== id) throw new ParadiseError("Paradise Comms did not confirm erasure of this recording.");
      // 409 recording_not_finished (mid-egress) and 503 recording_delete_failed
      // (row retained, retryable) already surfaced as ParadiseError with status.
    },

    async recordingAccess(recordingId: string): Promise<{ downloadTokenUrl: string; expiresAt: number }> {      const recording = await this.readRecording(recordingId);
      if (recording.status !== "available" || !recording.playback_url) {
        throw new ParadiseError("The Paradise Comms recording is not ready. Stop recording in the call, then refresh after processing finishes.");
      }
      const url = validatePlaybackUrl(recording.playback_url);
      // playback_url is a public Spaces URL with no signature expiry; the
      // access window Freeholder reports is bounded to the import/download use.
      const expiresAt = recording.expires_at ? Math.floor(new Date(recording.expires_at).getTime() / 1000)
        : Math.floor(now() / 1000) + 3600;
      return { downloadTokenUrl: url, expiresAt };
    },

    async downloadRecording(recordingId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
      const access = await this.recordingAccess(recordingId);
      try {
        // Public storage URLs are external input. Pin public DNS, refuse
        // redirects and never forward the Paradise credential to storage.
        const result = await download(access.downloadTokenUrl, { maxBytes: PARADISE_RECORDING_MAX_BYTES, timeoutMs: 60_000 });
        if (result.status !== 200 || result.bytes.byteLength === 0) throw new Error("Invalid recording response");
        return { bytes: result.bytes, contentType: result.contentType ?? "application/octet-stream" };
      } catch { throw new ParadiseError("The recording could not be downloaded safely within its size limit."); }
    },
  };
}
