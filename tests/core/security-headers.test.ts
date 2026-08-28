// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The global browser policy must agree with the capabilities the UI ships.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("security headers", () => {
  it("allows only same-origin capture while keeping unused sensors disabled", async () => {
    const groups = await nextConfig.headers!();
    const application = groups.find((group) => group.source === "/((?!preview).*)");
    const policy = application?.headers.find(
      (header) => header.key === "Permissions-Policy",
    )?.value;

    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("display-capture=(self)");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain("payment=()");
    expect(policy).not.toContain("camera=()");
    expect(policy).not.toContain("microphone=()");
  });

  it("keeps the policy aligned with Record Studio's browser APIs", () => {
    const studio = readFileSync(
      "app/(admin)/admin/media/RecordStudio.tsx",
      "utf8",
    );
    expect(studio).toContain("navigator.mediaDevices.getUserMedia");
    expect(studio).toContain("navigator.mediaDevices.getDisplayMedia");
  });
});
