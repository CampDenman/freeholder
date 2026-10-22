// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13 (owner decision 2026-10-22): the voice/video setup form preselects no
// provider, so an empty or unknown choice must come back as a validation
// message on the screen — never a silent default and never a 500.
import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/core/service";
import { parseVoiceVideoProviderChoice } from "../../plugins/voice-video/settings";

const redirects: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

describe("the voice/video provider choice", () => {
  it("accepts each listed provider", () => {
    expect(parseVoiceVideoProviderChoice("daily")).toBe("daily");
    expect(parseVoiceVideoProviderChoice("paradise")).toBe("paradise");
  });

  it.each(["", "pm_comms", undefined])("refuses %j as a validation error", (value) => {
    let thrown: unknown;
    try {
      parseVoiceVideoProviderChoice(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ServiceError);
    expect((thrown as ServiceError).code).toBe("validation");
  });

  it.each(["", "mystery"])("the setup action redirects %j back with a message instead of failing", async (provider) => {
    const { voiceVideoConfigureAction } = await import("../../app/(admin)/first-party-plugin-actions");
    const form = new FormData();
    form.set("provider", provider);
    redirects.length = 0;
    await expect(voiceVideoConfigureAction(form)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatch(/^\/admin\/voice-video\?error=/);
    expect(decodeURIComponent(redirects[0] ?? "")).toContain("Choose a call provider");
  });
});
