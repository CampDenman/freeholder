// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { getSiteChat, startSiteChat } from "@/core/messaging/chat";
import { assistantTurns } from "@/modules/assistant/schema";
import { answer, updateSettings, previewCall, settings, managedDetails, syncManagedSettings } from "@/modules/assistant/service";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { contentSecurityPolicy } from "@/core/http/csp";
import { installLaunch, launchPages, launchSpecSchema } from "@/modules/seed/launch";
import { ANONYMOUS, OWNER, closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";
import { openTransactions } from "../helpers/open-transactions";
import { resetEnvForTests } from "@/core/env";

const requestBody = (value: BodyInit | null | undefined): Record<string, unknown> =>
  typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : {};

describe("managed preview consumer contracts", () => {
  it("keeps v1/v2 unchanged and requires explicit v3 assistant/SFW settings", () => {
    const base = JSON.parse(readFileSync("seed/launch/example-v2.json", "utf8")) as Record<string, unknown>;
    expect(launchSpecSchema.parse(base).version).toBe(2);
    expect(launchSpecSchema.safeParse({ ...base, version: 3 }).success).toBe(false);
    const v3 = launchSpecSchema.parse({ ...base, version: 3, assistant: { provider: "paradise", enabled: true, dailyCapUsd: 1, contentMode: "sfw" } });
    expect(JSON.stringify(launchPages(v3))).toContain('"type":"siteChat"');
    expect(JSON.stringify(launchPages(v3))).toContain("not an endorsement");
    expect(launchSpecSchema.safeParse({ ...v3, version: 2 }).success).toBe(false);
    expect(launchSpecSchema.safeParse({ ...v3, assistant: { ...v3.assistant, contentMode: "adult" } }).success).toBe(false);
    expect(JSON.stringify(v3)).not.toContain("age_confirmed");
  });
  it("pins the distributed shared transport and every same-origin codec byte", () => {
    const root = "public/managed-assistant/0.1.10/";
    const manifest = JSON.parse(readFileSync(`${root}manifest.json`, "utf8")) as { codecs: Record<string, string>; moduleSha256: string };
    for (const [name, hash] of Object.entries(manifest.codecs)) {
      expect(createHash("sha256").update(readFileSync(`${root}duplex-codec/${name}`)).digest("hex")).toBe(hash);
    }
    const bundle = readFileSync(`${root}pm-ai-duplex-client.js`, "utf8");
    expect(bundle).toContain('"0.1.10"');
    expect(createHash("sha256").update(bundle.split("\n").slice(3).join("\n")).digest("hex")).toBe(manifest.moduleSha256);
  });
  it("only opens configured call origins and wasm on the assistant surface", () => {
    const options = { nonce: "fixture", production: true, assistantOrigins: ["https://voice.test", "wss://voice.test"] };
    expect(contentSecurityPolicy({ ...options, path: "/contact" })).toContain("https://voice.test wss://voice.test");
    expect(contentSecurityPolicy({ ...options, path: "/contact" })).toContain("'wasm-unsafe-eval'");
    expect(contentSecurityPolicy({ ...options, path: "/admin" })).not.toContain("voice.test");
  });
});

describe.runIf(hasDatabase)("managed assistants on the existing chat spine", () => {
  beforeAll(async () => ready(), 180000);
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call({ name: "Harbour Studio", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" }, OWNER);
    process.env.PARADISEMODERN_API_KEY = "test-only-managed-key";
    process.env.PARADISEMODERN_URL = "https://pm.test";
    process.env.PARADISEMODERN_ASSISTANT_ORIGINS = "https://voice.test";
    resetEnvForTests();
    await updateSettings.call({ enabled: true, provider: "paradise", model: "paradise-managed-assistant", maxOutputTokens: 600, spendCapCents: 100, spendPeriod: "day" }, OWNER);
  });
  afterEach(() => { setParadiseFetchForTests(undefined); });
  afterAll(async () => {
    delete process.env.PARADISEMODERN_API_KEY; delete process.env.PARADISEMODERN_URL; delete process.env.PARADISEMODERN_ASSISTANT_ORIGINS;
    await closeDb();
  });
  const chat = () => startSiteChat.call({ name: "Visitor", email: `${randomUUID()}@example.com`, message: "Hello", locale: "en" }, ANONYMOUS);
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  it("binds text to the cookie, holds the consumer cap and records its actual receipt on the canonical transcript", async () => {
    const session = await chat(); let sent: Record<string, unknown> = {};
    setParadiseFetchForTests(async (_url, init) => {
      expect(await openTransactions()).toBe(0);
      sent = requestBody(init.body);
      return reply({ text: "Hello! How can I help?", model: "managed-model", metered_list_usd: .04, content_mode: "sfw" });
    });
    expect((await answer.call({ token: session.token }, ANONYMOUS)).status).toBe("answered");
    expect(sent.visitor_ref).toBe(createHash("sha256").update(`pm-preview-assistant-visitor-v1\n${session.token}`).digest("hex"));
    expect(sent.max_charge_usd).toBe(1);
    expect((await db().select().from(assistantTurns))[0]?.costCents).toBe(4);
    const transcript = await getSiteChat.call({ token: session.token }, ANONYMOUS);
    expect(transcript.messages.at(-1)?.channel).toBe("assistant");
    expect(transcript.messages.at(-1)?.body).toContain("Hello!");
    expect(JSON.stringify(transcript)).not.toContain("test-only-managed-key");
  });

  it("retains the held budget after an unknown model timeout", async () => {
    let calls = 0;
    setParadiseFetchForTests(async () => { calls++; throw Error("lost response"); });
    const one = await chat();
    expect((await answer.call({ token: one.token }, ANONYMOUS)).status).toBe("failed");
    expect((await db().select().from(assistantTurns))[0]?.costCents).toBe(100);
    const two = await chat();
    expect((await answer.call({ token: two.token }, ANONYMOUS)).status).toBe("refused");
    expect(calls).toBe(1);
  });

  it("serializes claims so two visitors cannot spend the same remaining managed budget", async () => {
    const one = await chat(), two = await chat(); let invoked!: () => void, complete!: () => void;
    const started = new Promise<void>(resolve => { invoked = resolve; });
    const release = new Promise<void>(resolve => { complete = resolve; });
    let calls = 0;
    setParadiseFetchForTests(async () => { calls++; invoked(); await release; return reply({ text: "Hello!", model: "managed-model", metered_list_usd: .04, content_mode: "sfw" }); });
    const first = answer.call({ token: one.token }, ANONYMOUS);
    await started;
    try { expect((await answer.call({ token: two.token }, ANONYMOUS)).status).toBe("refused"); }
    finally { complete(); }
    expect((await first).status).toBe("answered"); expect(calls).toBe(1);
  });

  it("proxies only visitor-bound controls, fails to text without worker origins, and keeps End available after off", async () => {
    const session = await chat(), id = randomUUID(); const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    setParadiseFetchForTests(async (url, init) => {
      expect(await openTransactions()).toBe(0);
      requests.push({ url, body: requestBody(init.body) });
      return reply(url.endsWith("/config") ? { enabled: true, modes: ["video", "voice", "text"] } : { session_id: id, status: "ending" });
    });
    delete process.env.PARADISEMODERN_ASSISTANT_ORIGINS;
    resetEnvForTests();
    expect(await previewCall.call({ action: "config", token: session.token }, ANONYMOUS)).toMatchObject({ modes: ["text"] });
    await previewCall.call({ action: "poll", token: session.token, sessionId: id }, ANONYMOUS);
    expect(requests.at(-1)?.url).toMatch(/visitor_ref=[a-f0-9]{64}$/);
    expect((await failure(previewCall.call({ action: "poll", token: "x".repeat(40), sessionId: id }, ANONYMOUS))).code).toBe("not_found");
    await updateSettings.call({ enabled: false, provider: "paradise", model: "paradise-managed-assistant" }, OWNER);
    await previewCall.call({ action: "end", token: session.token, sessionId: id }, ANONYMOUS);
    expect(requests.at(-1)?.url).toContain("/end");
    expect((await failure(previewCall.call({ action: "start", token: session.token, want: "video" }, ANONYMOUS))).code).toBe("not_found");
  });

  it("puts bounded browser captions on the same conversation once, after PM verifies its visitor-bound session", async () => {
    const session = await chat(); const id = randomUUID();
    setParadiseFetchForTests(async () => reply({ status: "live", mode: "video" }));
    const input = { action: "caption" as const, token: session.token, sessionId: id, caption: { speaker: "muse" as const, text: "Hello from the call", startedAt: Date.now(), endedAt: Date.now() } };
    await previewCall.call(input, ANONYMOUS); await previewCall.call(input, ANONYMOUS);
    const transcript = await getSiteChat.call({ token: session.token }, ANONYMOUS);
    expect(transcript.messages.filter(message => message.body.includes("Hello from the call"))).toHaveLength(1);
    expect(transcript.messages.at(-1)?.body).toContain("browser-observed");
  });
  it("keeps managed talent and settings on the authorized service path", async () => {
    const remote = { enabled: true, talentSlug: "sienna-rodriguez", dailyCapUsd: 1 };
    setParadiseFetchForTests(async (url, init) => {
      expect(await openTransactions()).toBe(0);
      return reply(url.endsWith("/talent") ? { talent: [] } : { settings: init.method === "PATCH" ? requestBody(init.body) : remote });
    });
    expect((await failure(managedDetails.call({}, ANONYMOUS))).code).toBe("permission");
    expect((await managedDetails.call({}, OWNER)).settings).toEqual(remote);
    expect(await syncManagedSettings.call({ ...remote, enabled: false, dailyCapUsd: 2 }, OWNER)).toMatchObject({ settings: { enabled: false, dailyCapUsd: 2 } });
    expect((await failure(syncManagedSettings.call(remote, ANONYMOUS))).code).toBe("permission");
  });
  it("installs v3 through normal services and leaves v1/v2 behavior available", async () => {
    const base = JSON.parse(readFileSync("seed/launch/example-v2.json", "utf8")) as Record<string, unknown>;
    await installLaunch.call({ ...base, version: 3, assistant: { provider: "paradise", enabled: true, dailyCapUsd: 1, contentMode: "sfw" } }, { kind: "system" });
    expect(await settings.call({}, OWNER)).toMatchObject({ enabled: true, provider: "paradise", spendCapCents: 100, spendPeriod: "day" });
  });
});
