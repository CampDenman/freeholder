// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import manifests from "@/modules";
import { isPluginManifest } from "@/core/plugin";

const FIRST_PARTY = [
  "gift-registry",
  "print-on-demand",
  "community",
  "voice-video",
  "marketplace",
];

describe("first-party plugins (C3.13)", () => {
  it("ships each assigned plugin as definePlugin", () => {
    for (const name of FIRST_PARTY) {
      const manifest = manifests.find((item) => item.name === name);
      expect(manifest, name).toBeTruthy();
      expect(isPluginManifest(manifest!)).toBe(true);
      expect(manifest!.requires).toContain("core");
    }
  });
});
