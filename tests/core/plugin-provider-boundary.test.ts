// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13/C11.15: a deployed instance must never report fixture success as a
// provider acknowledgement. Real adapters remain tracked by C3.13.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { podProvider, fixturePodProvider } from "../../plugins/print-on-demand/adapter";
import { marketplaceProvider, fixtureMarketplaceProvider } from "../../plugins/marketplace/adapter";
import { voiceVideoProvider, fixtureVoiceVideoProvider } from "../../plugins/voice-video/adapter";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
import { ready } from "@/core/runtime";

afterEach(() => vi.unstubAllEnvs());

describe("first-party provider fixture boundary", () => {
  // Provider selection reads the stored voice-video settings row, so a row
  // saved by an earlier suite must not leak into these assertions.
  beforeEach(async () => { if (hasDatabase) { await ready(); await truncateSpine(); } });
  afterEach(async () => { if (hasDatabase) await closeDb(); });

  it.each(["production", "development", ""]) ("refuses fabricated provider success in %s", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(() => podProvider()).toThrow("No live print provider");
    expect(() => marketplaceProvider()).toThrow("No live marketplace provider");
    // With no stored settings and no Daily environment variables, the default
    // Paradise adapter refuses for want of a credential — never a fixture.
    await expect(voiceVideoProvider()).rejects.toThrow("Configure a Paradise Comms site API key");
  });

  it("keeps explicitly test-only provider fixtures available to acceptance suites", async () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(podProvider()).toBe(fixturePodProvider);
    expect(marketplaceProvider()).toBe(fixtureMarketplaceProvider);
    await expect(voiceVideoProvider()).resolves.toBe(fixtureVoiceVideoProvider);
  });
});
