// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13/C11.15: a deployed instance must never report fixture success as a
// provider acknowledgement. Real adapters remain tracked by C3.13.
import { afterEach, describe, expect, it, vi } from "vitest";
import { podProvider, fixturePodProvider } from "../../plugins/print-on-demand/adapter";
import { marketplaceProvider, fixtureMarketplaceProvider } from "../../plugins/marketplace/adapter";
import { voiceVideoProvider, fixtureVoiceVideoProvider } from "../../plugins/voice-video/adapter";
import type * as VoiceVideoSettings from "../../plugins/voice-video/settings";

// This suite is in the DB-free fast-gates contract (scripts/fast-gates.mjs).
// Provider selection reads the stored voice-video settings row; the lookup is
// stubbed to "nothing stored" so the assertions neither need a database nor
// inherit a row saved by an earlier suite.
vi.mock("../../plugins/voice-video/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof VoiceVideoSettings>();
  return {
    ...actual,
    readVoiceVideoSettings: vi.fn(async () => ({
      settings: actual.voiceVideoSettingsSchema.parse({}),
      stored: false,
    })),
  };
});

afterEach(() => vi.unstubAllEnvs());

describe("first-party provider fixture boundary", () => {
  it.each(["production", "development", ""]) ("refuses fabricated provider success in %s", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(() => podProvider()).toThrow("No live print provider");
    expect(() => marketplaceProvider()).toThrow("No live marketplace provider");
    // With no stored settings and no Daily environment variables there is no
    // provider at all: none is chosen on the owner's behalf (2026-10-22) and
    // a fixture never stands in.
    await expect(voiceVideoProvider()).rejects.toThrow("No live voice/video provider is configured");
  });

  it("keeps explicitly test-only provider fixtures available to acceptance suites", async () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(podProvider()).toBe(fixturePodProvider);
    expect(marketplaceProvider()).toBe(fixtureMarketplaceProvider);
    await expect(voiceVideoProvider()).resolves.toBe(fixtureVoiceVideoProvider);
  });
});
