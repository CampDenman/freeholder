// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Vendor SDKs stay behind this plugin (MASTER.md §4.14). Core owns the
// conversation and the timeline; this file is the only place a WebRTC vendor
// would ever be imported.
export interface VoiceVideoRoomInput {
  kind: "voice" | "video";
  provider: string;
  title: string;
}

export interface VoiceVideoRoomResult {
  externalRef: string;
}

export interface VoiceVideoCaptureInput {
  kind: "voice" | "video";
  provider: string;
  title: string;
  externalRef?: string;
}

export interface VoiceVideoCaptureResult {
  externalRef: string;
  transcript: string;
  durationSeconds: number;
}

export interface VoiceVideoProvider {
  startRoom(input: VoiceVideoRoomInput): Promise<VoiceVideoRoomResult>;
  capture(input: VoiceVideoCaptureInput): Promise<VoiceVideoCaptureResult>;
}

function refused(input: { title: string }): boolean {
  return input.title.startsWith("fail-");
}

/** Fixture provider: start and capture fail when the title asks them to. */
export const fixtureVoiceVideoProvider: VoiceVideoProvider = {
  async startRoom(input) {
    if (refused(input)) {
      throw new Error("The call provider could not open that room.");
    }
    return { externalRef: `vv-room:${input.provider}:${input.kind}:${input.title}` };
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
};

export function voiceVideoProvider(): VoiceVideoProvider {
  return fixtureVoiceVideoProvider;
}
