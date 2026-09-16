// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Daily REST room lifecycle. https://docs.daily.co/reference/rest-api/rooms/create-room
import { z } from "zod";
import { getPinnedBytes } from "@/core/http/pinned-download";
import { readBoundedBytes } from "@/core/http/body";

export interface DailyConfiguration { apiKey: string; domain: string }
export class DailyError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "DailyError"; }
}
const nameSchema = z.string().regex(/^fh-[0-9a-f-]{36}$/);
const roomSchema = z.object({ id: z.string().uuid(), name: nameSchema, privacy: z.literal("private"), url: z.string().url(),
  config: z.object({ exp: z.number().int().positive() }) });
export interface DailyRoom { providerRoomId: string; externalRef: string; roomUrl: string; expiresAt: number }
export interface DailyRecording { id: string; roomName: string; meetingSessionId: string; durationSeconds: number }

export function createDailyClient(configuration: DailyConfiguration, fetcher: typeof fetch = fetch, now = Date.now, download: typeof getPinnedBytes = getPinnedBytes) {
  const apiKey = configuration.apiKey.trim();
  const domain = configuration.domain.trim().toLowerCase();
  if (!apiKey || /[\r\n]/.test(apiKey) || !/^[a-z0-9][a-z0-9-]*\.daily\.co$/.test(domain)) {
    throw new DailyError("Configure a Daily API key and your daily.co domain before opening rooms.");
  }
  async function request(path: string, method = "GET", body?: unknown, allowMissing = false): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`https://api.daily.co/v1${path}`, { method,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(20_000) });
    } catch { throw new DailyError("Daily could not be reached. Retry the same room operation."); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (allowMissing && response.status === 404) return null;
      throw new DailyError(`Daily refused the request (HTTP ${response.status}).`, response.status);
    }
    if (response.status === 204) return null;
    try { return JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 1_048_576))) as unknown; }
    catch { throw new DailyError("Daily returned an unreadable or oversized response."); }
  }
  function validateRoom(value: unknown, name: string): DailyRoom {
    const result = roomSchema.safeParse(value);
    if (!result.success || result.data.name !== name) throw new DailyError("Daily did not verify this private room's identity and expiry.");
    const url = new URL(result.data.url);
    if (url.protocol !== "https:" || url.host !== domain || url.pathname !== `/${name}` || url.search || url.hash || url.username || url.password) {
      throw new DailyError("This room belongs to a different Daily domain. Restore its original configuration.");
    }
    return { providerRoomId: result.data.id, externalRef: `${domain}/${name}`, roomUrl: url.href, expiresAt: result.data.config.exp };
  }
  function nameFromRef(externalRef: string): string {
    const prefix = `${domain}/`;
    const name = externalRef.startsWith(prefix) ? externalRef.slice(prefix.length) : "";
    if (!nameSchema.safeParse(name).success) throw new DailyError("This room belongs to a different Daily domain or has no valid provider identity.");
    return name;
  }
  async function readRoom(name: string) {
    const response = await request(`/rooms/${name}`, "GET", undefined, true);
    return response === null ? null : validateRoom(response, name);
  }
  async function presence(name: string) {
    const parsed = z.object({ total_count: z.number().int().nonnegative(), data: z.array(z.object({ id: z.string().uuid(), room: z.string() })).max(100) }).safeParse(await request(`/rooms/${name}/presence`));
    if (!parsed.success || parsed.data.total_count !== parsed.data.data.length || parsed.data.data.some(person => person.room !== name)) {
      throw new DailyError("Daily did not return a complete participant list for this room.");
    }
    return parsed.data.data;
  }
  return {
    async verifyDomain(): Promise<void> {
      const result = z.object({ domain_name: z.string().min(1).max(100) }).safeParse(await request("/"));
      if (!result.success || ![domain, domain.replace(/\.daily\.co$/, "")].includes(result.data.domain_name.toLowerCase())) {
        throw new DailyError("The Daily API key belongs to a different domain.");
      }
    },
    async recordingAccess(recordingId: string) {
      if (!z.string().uuid().safeParse(recordingId).success) throw new DailyError("This recording has no valid provider identity.");
      const result = z.object({ download_link: z.string().url().max(8192), expires: z.number().int() }).safeParse(await request(`/recordings/${recordingId}/access-link`));
      if (!result.success || result.data.expires <= Math.floor(now() / 1000)) throw new DailyError("Daily did not return a valid recording download link.");
      const url = new URL(result.data.download_link);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new DailyError("Daily returned an unsafe recording download link.");
      return { downloadTokenUrl: url.href, expiresAt: result.data.expires };
    },
    async ensureRoom(input: { roomId: string; kind: "voice" | "video"; expiresAt: number }): Promise<DailyRoom> {
      if (!z.string().uuid().safeParse(input.roomId).success || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Math.floor(now() / 1000)) {
        throw new DailyError("This room request has expired. Create a new room.");
      }
      const name = `fh-${input.roomId}`;
      const existing = await readRoom(name);
      if (existing) {
        if (existing.expiresAt <= Math.floor(now() / 1000)) throw new DailyError("This Daily room has expired. Create a new room.");
        return existing;
      }
      try {
        return validateRoom(await request("/rooms", "POST", { name, privacy: "private", properties: {
          exp: input.expiresAt, eject_at_room_exp: true, max_participants: 20,
          start_audio_off: true, start_video_off: true,
          enable_recording: input.kind === "voice" ? "cloud-audio-only" : "cloud",
          enable_transcription_storage: true,
        } }), name);
      } catch (error) {
        // A deterministic room name recovers a create whose response was lost.
        // Recovery is a read; it never starts a second room or extends expiry.
        const recovered = await readRoom(name);
        if (recovered && recovered.expiresAt > Math.floor(now() / 1000)) return recovered;
        throw error;
      }
    },

    async createMeetingToken(input: { externalRef: string; providerRoomId: string; userId: string; userName: string; owner: boolean }) {
      const name = nameFromRef(input.externalRef);
      const room = await readRoom(name);
      if (!room || room.providerRoomId !== input.providerRoomId || room.expiresAt <= Math.floor(now() / 1000)) {
        throw new DailyError("This Daily room is unavailable or expired.");
      }
      if (!input.userId || input.userId.length > 36 || !input.userName.trim() || input.userName.length > 200) throw new DailyError("Supply a valid participant identity.");
      const expiresAt = Math.min(room.expiresAt, Math.floor(now() / 1000) + 1800);
      const parsed = z.object({ token: z.string().min(1).max(16_384) }).safeParse(await request("/meeting-tokens", "POST", {
        properties: { room_name: name, exp: expiresAt, is_owner: input.owner, user_id: input.userId,
          user_name: input.userName, start_audio_off: true, start_video_off: true },
      }));
      if (!parsed.success) throw new DailyError("Daily did not return a meeting token.");
      // Keep the token separate from the public URL so central audit redaction
      // recognizes the credential. Never store it on a room/list response.
      return { roomUrl: room.roomUrl, meetingToken: parsed.data.token, expiresAt };
    },

    async endRoom(input: { externalRef: string; providerRoomId: string }): Promise<void> {
      const name = nameFromRef(input.externalRef);
      const room = await readRoom(name);
      if (!room) throw new DailyError("Daily cannot verify this missing room. Reconcile its call state before marking it ended.");
      if (room.providerRoomId !== input.providerRoomId) throw new DailyError("Daily returned a different room identity.");
      // Expiration prevents new joins; ejection handles participants already in
      // the session. A DELETE alone is not proof that their call has ended.
      await request(`/rooms/${name}`, "POST", { properties: { exp: Math.floor(now() / 1000) - 1, eject_at_room_exp: true } });
      const participants = await presence(name);
      if (participants.length) await request(`/rooms/${name}/eject`, "POST", { ids: participants.map(person => person.id) });
      if ((await presence(name)).length) throw new DailyError("Daily is still ending this call. Retry shortly.");
      // Keep the expired room available for retry verification. Deleting it
      // would discard the evidence needed after a lost local apply result.
    },

    async eraseRoomRecordings(input: { externalRef: string; providerRoomId: string | null }): Promise<void> {
      const deadline = Date.now() + 120_000;
      const checkpoint = () => { if (Date.now() > deadline) throw new DailyError("Provider erasure reached its time budget. Retry the same job."); };
      const name = nameFromRef(input.externalRef);
      const room = await readRoom(name);
      if (room && input.providerRoomId && room.providerRoomId !== input.providerRoomId) throw new DailyError("This Daily room no longer has its original identity.");
      const providerRoomId = input.providerRoomId ?? room?.providerRoomId;
      if (!providerRoomId) throw new DailyError("Restore the original room identity before erasing provider recordings.");
      if (room) await this.endRoom({ externalRef: input.externalRef, providerRoomId });
      const recordingPath = `/recordings?room_name=${name}&limit=100`;
      const recordingList = z.object({ total_count: z.number().int().nonnegative(), data: z.array(z.object({ id: z.uuid() })).max(100) });
      const recordings = recordingList.safeParse(await request(recordingPath));
      if (!recordings.success || recordings.data.total_count < recordings.data.data.length) throw new DailyError("Daily did not return a valid recording erasure inventory.");
      for (const item of recordings.data.data) {
        checkpoint();
        const metadata = await request(`/recordings/${item.id}`, "GET", undefined, true);
        if (metadata === null) continue;
        const verified = z.object({ id: z.uuid(), room_name: z.string(), status: z.literal("finished") }).safeParse(metadata);
        if (!verified.success || verified.data.id !== item.id || verified.data.room_name !== name) throw new DailyError("Daily has not verified a finished recording for erasure from this room.");
        const deleted = await request(`/recordings/${item.id}`, "DELETE", undefined, true);
        if (deleted !== null) {
          const confirmation = z.object({ deleted: z.literal(true), id: z.uuid() }).safeParse(deleted);
          if (!confirmation.success || confirmation.data.id !== item.id) throw new DailyError("Daily did not confirm erasure of this recording.");
        }
      }
      const remaining = recordingList.safeParse(await request(recordingPath));
      if (!remaining.success || remaining.data.total_count !== 0 || remaining.data.data.length !== 0) throw new DailyError("Daily recording erasure remains pending. Retry the same job.");
      const transcript = z.object({ transcriptId: z.uuid(), roomId: z.uuid(), status: z.string() });
      async function transcripts() {
        const all: z.infer<typeof transcript>[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          checkpoint();
          const result = z.object({ total_count: z.number().int().nonnegative(), data: z.array(transcript).max(100) }).safeParse(
            await request(`/transcript?roomId=${providerRoomId}&limit=100${cursor ? `&starting_after=${cursor}` : ""}`));
          if (!result.success || result.data.total_count < all.length + result.data.data.length) throw new DailyError("Daily returned an incomplete transcript erasure inventory.");
          for (const item of result.data.data) {
            if (item.roomId !== providerRoomId || seen.has(item.transcriptId)) throw new DailyError("Daily returned a mismatched or repeated transcript for erasure.");
            seen.add(item.transcriptId); all.push(item);
          }
          if (all.length === result.data.total_count) return all;
          if (!result.data.data.length) throw new DailyError("Daily transcript pagination ended before every record was verified.");
          cursor = result.data.data.at(-1)!.transcriptId;
        }
        throw new DailyError("The transcript erasure inventory exceeds the bounded page limit.");
      }
      for (const item of await transcripts()) {
        checkpoint();
        if (item.status === "t_deleted") continue;
        if (item.status === "t_in_progress") throw new DailyError("Daily is still processing a transcript. Retry erasure shortly.");
        const deleted = await request(`/transcript/${item.transcriptId}`, "DELETE", undefined, true);
        if (deleted !== null) {
          const confirmation = transcript.safeParse(deleted);
          if (!confirmation.success || confirmation.data.transcriptId !== item.transcriptId || confirmation.data.roomId !== providerRoomId || confirmation.data.status !== "t_deleted") throw new DailyError("Daily did not confirm erasure of this transcript.");
        }
      }
      if ((await transcripts()).some(item => item.status !== "t_deleted")) throw new DailyError("Daily transcript erasure remains pending. Retry the same job.");
    },

    async findRecording(input: { externalRef: string; recordingId?: string }): Promise<DailyRecording> {
      const name = nameFromRef(input.externalRef);
      let candidateId = input.recordingId;
      if (!candidateId) {
        const result = z.object({ data: z.array(z.object({ id: z.string().uuid(), start_ts: z.number(), status: z.string() })).max(100) }).safeParse(await request(`/recordings?room_name=${name}&limit=100`));
        if (!result.success) throw new DailyError("Daily did not return a valid recording list.");
        const latest = [...result.data.data].sort((a, b) => b.start_ts - a.start_ts)[0];
        if (!latest || latest.status !== "finished") throw new DailyError("The Daily recording is not ready. Stop recording in the call, then refresh after processing finishes.");
        candidateId = latest.id;
      }
      if (!z.string().uuid().safeParse(candidateId).success) throw new DailyError("This recording has no valid provider identity.");
      const parsed = z.object({ id: z.string().uuid(), room_name: z.string(), status: z.literal("finished"), duration: z.number().int().nonnegative(), mtgSessionId: z.string().uuid() }).safeParse(await request(`/recordings/${candidateId}`));
      if (!parsed.success || parsed.data.id !== candidateId || parsed.data.room_name !== name) throw new DailyError("Daily has not verified a finished recording for this room.");
      return { id: parsed.data.id, roomName: name, durationSeconds: parsed.data.duration, meetingSessionId: parsed.data.mtgSessionId };
    },

    async readTranscript(input: { providerRoomId: string; meetingSessionId: string }): Promise<string | null> {
      if (!z.string().uuid().safeParse(input.providerRoomId).success || !z.string().uuid().safeParse(input.meetingSessionId).success) throw new DailyError("This transcript has no verified meeting identity.");
      const parsed = z.object({ total_count: z.number().int().nonnegative(), data: z.array(z.object({
        transcriptId: z.string().uuid(), roomId: z.string().uuid(), mtgSessionId: z.string().uuid(),
        status: z.string(), isVttAvailable: z.boolean(), created_at: z.string(),
      })).max(20) }).safeParse(await request(`/transcript?mtgSessionId=${input.meetingSessionId}&limit=20`));
      if (!parsed.success || parsed.data.total_count !== parsed.data.data.length || parsed.data.data.some(item => item.roomId !== input.providerRoomId || item.mtgSessionId !== input.meetingSessionId)) {
        throw new DailyError("Daily did not return complete transcript metadata for this meeting.");
      }
      if (!parsed.data.data.length || parsed.data.data.some(item => item.status !== "t_finished" || !item.isVttAvailable)) return null;
      const parts: string[] = [];
      let remaining = 100_000;
      for (const item of [...parsed.data.data].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        const access = z.object({ transcriptId: z.string().uuid(), link: z.string().url().optional(), download_link: z.string().url().optional() }).safeParse(await request(`/transcript/${item.transcriptId}/access-link`));
        const raw = access.success ? (access.data.link ?? access.data.download_link) : undefined;
        if (!access.success || access.data.transcriptId !== item.transcriptId || !raw || new URL(raw).protocol !== "https:" || Boolean(new URL(raw).username || new URL(raw).password)) throw new DailyError("Daily did not return a verified transcript download link.");
        try {
          // Signed storage URLs are external input. Pin public DNS, refuse
          // redirects and never forward the Daily API credential to storage.
          const result = await download(raw, { maxBytes: remaining, timeoutMs: 20_000 });
          if (result.status !== 200 || result.bytes.byteLength > remaining) throw new Error("Invalid transcript response");
          const text = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
          if (!/^WEBVTT(?:[ \t]|\r?\n|$)/.test(text)) throw new Error("Invalid WebVTT");
          parts.push(text);
          remaining -= result.bytes.byteLength + 2;
          if (remaining <= 0) throw new Error("Transcript exceeds limit");
        } catch { throw new DailyError("The transcript could not be downloaded safely within its size limit."); }
      }
      return parts.join("\n\n");
    },
  };
}
