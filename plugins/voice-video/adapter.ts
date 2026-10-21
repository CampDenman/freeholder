// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Vendor SDKs stay behind this plugin (MASTER.md §4.14). Core owns the
// conversation and the timeline; this file is the only place a WebRTC vendor
// would ever be imported.
import { env } from "@/core/env";
import { getPinnedBytes } from "@/core/http/pinned-download";
import { z } from "zod";
import { createDailyClient, DailyError, type DailyConfiguration } from "./daily";
import { createParadiseVoiceVideoProvider } from "./paradise-provider";
import {
  readVoiceVideoSettings,
  resolveParadiseConfig,
} from "./settings";

export interface VoiceVideoAccessInput {
  provider: string; externalRef: string | null; providerRoomId: string | null; accountDomain: string | null;
}
export interface VoiceVideoRoomInput {
  roomId: string;
  accountDomain: string | null;
  expiresAt: number;
  kind: "voice" | "video";
  provider: string;
  title: string;
}

export interface VoiceVideoRoomResult {
  providerRoomId: string | null;
  externalRef: string;
}

export interface VoiceVideoCaptureInput {
  roomExternalRef: string | null;
  providerRoomId: string | null;
  accountDomain: string | null;
  kind: "voice" | "video";
  provider: string;
  title: string;
  externalRef?: string;
}

export interface VoiceVideoCaptureResult {
  externalRef: string;
  transcript: string | null;
  durationSeconds: number;
}

export interface VoiceVideoMeetingTokenResult {
  roomUrl: string;
  meetingToken: string;
  expiresAt: number;
  /** Paradise Comms/LiveKit connection details, when the provider issues them. */
  livekitUrl?: string;
  iceServers?: unknown[];
}

export interface VoiceVideoRecordingResult {
  providerRecordingId: string;
  status: string;
}

export interface VoiceVideoProvider {
  downloadRecording(input: VoiceVideoAccessInput & { recordingId: string }): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }>;
  eraseRoomRecordings(input: VoiceVideoAccessInput): Promise<void>;
  endRoom(input: VoiceVideoAccessInput): Promise<void>;
  meetingToken(input: VoiceVideoAccessInput & { userId: string; userName: string; owner: boolean }): Promise<VoiceVideoMeetingTokenResult>;
  recordingAccess(input: VoiceVideoAccessInput & { recordingId: string }): Promise<{ downloadTokenUrl: string; expiresAt: number }>;
  startRoom(input: VoiceVideoRoomInput): Promise<VoiceVideoRoomResult>;
  capture(input: VoiceVideoCaptureInput): Promise<VoiceVideoCaptureResult>;
  startRecording?(input: VoiceVideoAccessInput & { audioOnly: boolean }): Promise<VoiceVideoRecordingResult>;
  stopRecording?(input: VoiceVideoAccessInput): Promise<VoiceVideoRecordingResult | null>;
}

function refused(input: { title: string }): boolean {
  return input.title.startsWith("fail-");
}

function refusedRecording(input: { externalRef: string | null }): boolean {
  return input.externalRef?.includes("fail-") ?? false;
}

/** Fixture provider: start and capture fail when the title asks them to. */
export const fixtureVoiceVideoProvider: VoiceVideoProvider = {
  async downloadRecording() {
    return {
      bytes: new TextEncoder().encode("fixture recording bytes"),
      contentType: "video/mp4",
    };
  },
  async endRoom() {},
  async eraseRoomRecordings() {},
  async meetingToken() { throw new Error("Fixture rooms have no live meeting token."); },
  async recordingAccess() { throw new Error("Fixture recordings have no live download link."); },
  async startRoom(input) {
    if (refused(input)) {
      throw new Error("The call provider could not open that room.");
    }
    return { providerRoomId: input.roomId, externalRef: `vv-room:${input.provider}:${input.kind}:${input.title}` };
  },
  async capture(input) {
    if (refused(input)) {
      throw new Error("The call provider could not store that recording.");
    }
    return {
      externalRef: input.externalRef ?? `vv:${input.provider}:${input.kind}:${input.title}`,
      transcript: `${input.kind} recording: ${input.title}`,
      durationSeconds: 42,
    };
  },
  async startRecording(input) {
    if (refusedRecording(input)) throw new Error("The call provider could not start recording.");
    return { providerRecordingId: `vv-recording:${input.externalRef ?? "fixture"}`, status: "active" };
  },
  async stopRecording() { return null; },
};

/**
 * The live provider for this instance. Settings in module_settings decide
 * which adapter serves new work; an instance that only ever set the Daily
 * environment variables (no stored settings row) keeps its Daily provider,
 * so the pivot forces no migration.
 */
export async function voiceVideoProvider(): Promise<VoiceVideoProvider> {
  if (process.env.NODE_ENV === "test") return fixtureVoiceVideoProvider;
  const { settings, stored } = await readVoiceVideoSettings();
  if (settings.provider === "daily" || (!stored && env().DAILY_API_KEY && env().DAILY_DOMAIN)) {
    const daily = env();
    if (!daily.DAILY_API_KEY || !daily.DAILY_DOMAIN) {
      throw new Error("No live voice/video provider is configured. Set the Daily API key and domain or configure Paradise Comms in settings.");
    }
    return createDailyVoiceVideoProvider({ apiKey: daily.DAILY_API_KEY, domain: daily.DAILY_DOMAIN });
  }
  return createParadiseVoiceVideoProvider(resolveParadiseConfig(settings));
}

export { createParadiseVoiceVideoProvider } from "./paradise-provider";
export type { ParadiseConfiguration } from "./paradise";

export function createDailyVoiceVideoProvider(configuration: DailyConfiguration, fetcher: typeof fetch = fetch, download: typeof getPinnedBytes = getPinnedBytes): VoiceVideoProvider {
  const client = createDailyClient(configuration, fetcher, Date.now, download);
  async function verify(input: { provider: string; accountDomain: string | null }) {
    if (input.provider !== "daily") throw new DailyError("This instance's live voice/video provider is Daily.");
    if (input.accountDomain && input.accountDomain.trim().toLowerCase() !== configuration.domain.trim().toLowerCase()) throw new DailyError("Restore this room's original Daily domain before retrying.");
    await client.verifyDomain();
  }
  function identity(input: VoiceVideoAccessInput) {
    if (!input.externalRef || !input.providerRoomId) throw new DailyError("This room has no verified Daily session. Create a new room.");
    return { externalRef: input.externalRef, providerRoomId: input.providerRoomId };
  }
  return {
    async downloadRecording(input) {
      await verify(input);
      if (!z.string().uuid().safeParse(input.recordingId).success) throw new DailyError("This recording has no valid provider identity.");
      return client.downloadRecording(input.recordingId);
    },
    async eraseRoomRecordings(input) {
      await verify(input);
      if (!input.externalRef) throw new DailyError("This erasure task has no original room reference.");
      await client.eraseRoomRecordings({ externalRef: input.externalRef, providerRoomId: input.providerRoomId });
    },
    async startRoom(input) {
      await verify(input);
      const room = await client.ensureRoom(input);
      return { externalRef: room.externalRef, providerRoomId: room.providerRoomId };
    },
    async endRoom(input) { await verify(input); await client.endRoom(identity(input)); },
    async meetingToken(input) { await verify(input); return client.createMeetingToken({ ...identity(input), userId: input.userId, userName: input.userName, owner: input.owner }); },
    async recordingAccess(input) {
      await verify(input);
      const room = identity(input);
      const recording = await client.findRecording({ externalRef: room.externalRef, recordingId: input.recordingId });
      return client.recordingAccess(recording.id);
    },
    async capture(input) {
      await verify(input);
      const room = identity({ ...input, externalRef: input.roomExternalRef });
      const recording = await client.findRecording({ externalRef: room.externalRef, recordingId: input.externalRef });
      const transcript = await client.readTranscript({ providerRoomId: room.providerRoomId, meetingSessionId: recording.meetingSessionId });
      return { externalRef: recording.id, transcript, durationSeconds: recording.durationSeconds };
    },
  };
}
