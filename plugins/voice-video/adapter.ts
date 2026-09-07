// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Vendor SDKs stay behind this plugin (MASTER.md §4.14, C3.13).
export interface VoiceVideoCaptureInput {
  kind: "voice" | "video";
  provider: string;
  title: string;
}

export interface VoiceVideoCaptureResult {
  externalRef: string;
  transcript: string;
}

export interface VoiceVideoProvider {
  capture(input: VoiceVideoCaptureInput): Promise<VoiceVideoCaptureResult>;
}

/** Fixture provider: capture fails when the title asks it to. */
export const fixtureVoiceVideoProvider: VoiceVideoProvider = {
  async capture(input) {
    if (input.title.startsWith("fail-")) {
      throw new Error("The call provider could not store that recording.");
    }
    return {
      externalRef: `vv:${input.provider}:${input.kind}`,
      transcript: `${input.kind} recording: ${input.title}`,
    };
  },
};

export function voiceVideoProvider(): VoiceVideoProvider {
  return fixtureVoiceVideoProvider;
}
