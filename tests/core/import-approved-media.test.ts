// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: hosted exports use explicit public media origins, never page origins.
import { describe, expect, it } from "vitest";
import { stageImportSource } from "@/core/import/service";
import { approvedMediaOriginsSchema } from "@/core/import/media-origins";

const ORIGIN = "https://hosted-source.example/team.html";
const BODY = '<main><h1>Hosted team</h1><img src="https://images.hosted-cdn.example/image?id=one" alt="Fictional team"></main>';

describe("explicit hosted source media approval (C3.22)", () => {
  it("stages an approved public CDN image with its full source identity", () => {
    const staged = stageImportSource("html", BODY, ORIGIN, "", ["https://images.hosted-cdn.example"]);
    expect(staged.counts).toMatchObject({ pages: 1, media: 1, mediaWarnings: 0 });
    expect(staged.preview).toMatchObject({ generic: { media: [{ key: "https://images.hosted-cdn.example/image?id=one" }] } });
  });
  it("keeps a CDN image unresolved without the owner's approval", () => {
    expect(stageImportSource("html", BODY, ORIGIN).counts).toMatchObject({ media: 0, mediaWarnings: 1 });
  });
  it("refuses nonpublic or non-origin approvals and keeps the list bounded", () => {
    const credentialed = new URL("https://public.example"); credentialed.username = "fixture"; credentialed.password = "fixture";
    for (const value of [credentialed.href, "https://localhost", "https://127.10.2.3", "https://[fd00::1]", "https://[::ffff:127.0.0.1]", "https://192.168.1.1", "file:///tmp/image", "https://public.example/path", "https://public.example?token=fixture", "https://public.example/#fragment"]) expect(approvedMediaOriginsSchema.safeParse([value]).success).toBe(false);
    expect(approvedMediaOriginsSchema.safeParse(Array.from({ length: 9 }, (_, index) => `https://cdn${index}.example`)).success).toBe(false);
    expect(approvedMediaOriginsSchema.parse(["https://PUBLIC.example:443/"])).toEqual(["https://public.example"]);
  });
  it("does not extend approval to a lookalike hostname or a different scheme", () => {
    const body = '<main><img src="https://images.hosted-cdn.example.attacker.example/a.png"><img src="http://images.hosted-cdn.example/a.png"></main>';
    expect(stageImportSource("html", body, ORIGIN, "", ["https://images.hosted-cdn.example"]).counts).toMatchObject({ media: 0, mediaWarnings: 2 });
  });
});
