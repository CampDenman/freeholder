// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13/C11.15: a deployed instance must never report fixture success as a
// provider acknowledgement. Real adapters remain tracked by C3.13.
import { afterEach, describe, expect, it, vi } from "vitest";
import { podProvider, fixturePodProvider } from "../../plugins/print-on-demand/adapter";
import { marketplaceProvider, fixtureMarketplaceProvider } from "../../plugins/marketplace/adapter";
import { voiceVideoProvider, fixtureVoiceVideoProvider } from "../../plugins/voice-video/adapter";

afterEach(() => vi.unstubAllEnvs());

describe("first-party provider fixture boundary", () => {
  it.each(["production", "development", ""]) ("refuses fabricated provider success in %s", (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(() => podProvider()).toThrow("No live print provider");
    expect(() => marketplaceProvider()).toThrow("No live marketplace provider");
    expect(() => voiceVideoProvider()).toThrow("No live voice/video provider");
  });

  it("keeps explicitly test-only provider fixtures available to acceptance suites", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(podProvider()).toBe(fixturePodProvider);
    expect(marketplaceProvider()).toBe(fixtureMarketplaceProvider);
    expect(voiceVideoProvider()).toBe(fixtureVoiceVideoProvider);
  });
});
