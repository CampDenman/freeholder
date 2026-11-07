// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PM owns admission and transport grants; the site binds every operation to
// its validated chat cookie. No caller can select a persona, account or key.
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { sessionForToken } from "@/core/messaging/chat";
import { defineOrchestratedService, defineService, getService, ServiceError } from "@/core/service";
import { paradiseRequest } from "@/adapters/paradise/http";
import { assistantSettings } from "./schema";
import { env } from "@/core/env";
import { parseCspOrigins } from "@/core/http/csp";

const token = z.string().trim().min(32).max(200);
const caption = z.object({
  speaker: z.enum(["member", "muse"]), text: z.string().trim().min(1).max(2000),
  startedAt: z.number().int().positive(), endedAt: z.number().int().positive(),
}).strict().refine(value => value.endedAt >= value.startedAt && value.endedAt - value.startedAt <= 300000, "Invalid caption timing.");
const previewAccess = defineService({
  name: "assistant.previewAccess", summary: "Bind a managed call to an existing site chat.",
  kind: "query", permission: "public", external: false, agentCallable: false,
  input: z.object({ token, ending: z.boolean() }),
  output: z.object({ visitorRef: z.string() }),
  handler: async (input, ctx) => {
    await sessionForToken(ctx.tx, input.token, { allowClosed: input.ending });
    const [settings] = await ctx.tx.select().from(assistantSettings).where(eq(assistantSettings.id, 1)).limit(1);
    // Stopping remains possible after the owner switches the assistant off.
    if ((!settings?.enabled || settings.provider !== "paradise") && !input.ending) {
      throw new ServiceError("not_found", "The managed assistant is not enabled.");
    }
    return { visitorRef: createHash("sha256").update(`pm-preview-assistant-visitor-v1\n${input.token}`).digest("hex") };
  },
});

const control = z.discriminatedUnion("action", [
  z.object({ action: z.literal("config"), token }).strict(),
  z.object({ action: z.literal("start"), token, want: z.enum(["voice", "video"]) }).strict(),
  z.object({ action: z.literal("poll"), token, sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("queued"), token, sessionId: z.string().uuid(), want: z.enum(["voice", "video"]) }).strict(),
  z.object({ action: z.literal("lease"), token, sessionId: z.string().uuid(), authorizedUntilMs: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("end"), token, sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("caption"), token, sessionId: z.string().uuid(), caption }).strict(),
]);

const saveCaption = defineService({
  name: "assistant.saveCallCaption", summary: "Put browser-observed call captions on the existing conversation.",
  kind: "mutation", permission: "public", writeClass: "message", external: false, agentCallable: false,
  input: z.object({ token, sessionId: z.string().uuid(), caption }), output: z.object({ saved: z.boolean() }),
  rateLimit: { limit: 90, windowSeconds: 300, subject: input => createHash("sha256").update(input.token).digest("hex"), message: "Some call captions could not be saved. You can still type a message." },
  handler: async (input, ctx) => {
    const session = await sessionForToken(ctx.tx, input.token);
    const hash = createHash("sha256").update(JSON.stringify(input.caption)).digest("hex");
    const providerRef = `pm-call-caption:${input.sessionId}:${hash}`;
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${providerRef}))`);
    // These are explicitly browser observations, not worker/audio receipts.
    // They can never be used as authority for billing, consent or identity.
    const who = input.caption.speaker === "member" ? "visitor" : "AI assistant";
    await ctx.callAsSystem(getService("conversations.record"), {
      conversationId: session.conversationId, contactId: session.contactId, chatSessionId: session.id,
      direction: input.caption.speaker === "member" ? "inbound" : "outbound",
      channel: input.caption.speaker === "member" ? "chat" : "assistant",
      sentBy: input.caption.speaker === "member" ? "contact" : "automation", providerRef,
      body: `[Call caption: ${who}; browser-observed]\n${input.caption.text}`,
    });
    ctx.setSubject("conversation", session.conversationId);
    return { saved: true };
  },
});

export const previewCall = defineOrchestratedService({
  name: "assistant.previewCall", summary: "Control this browser's managed assistant call.",
  kind: "mutation", permission: "public", writeClass: "message",
  // PM bounds starts; end is always available without a spending/rate gate.
  input: control, output: z.unknown(),
  handler: async (input, actor) => {
    const { visitorRef } = await previewAccess.call({ token: input.token, ending: input.action === "end" }, actor);
    const base = "/v1/ai/assistant";
    if (input.action === "config") {
      const result = await paradiseRequest<Record<string, unknown>>(`${base}/config`, { method: "GET" });
      return parseCspOrigins(env().PARADISEMODERN_ASSISTANT_ORIGINS).length ? result.body : { ...result.body, modes: ["text"] };
    }
    if (input.action === "start") return (await paradiseRequest(`${base}/sessions`, { body: { visitor_ref: visitorRef, want: input.want } })).body;
    const session = `${base}/sessions/${input.sessionId}`;
    if (input.action === "caption") {
      const observed = await paradiseRequest<{ status: string; mode: string }>(session, { method: "GET", query: { visitor_ref: visitorRef } });
      if (!["live", "ending", "ended"].includes(observed.body.status) || !["voice", "video"].includes(observed.body.mode)) {
        throw new ServiceError("conflict", "There is no admitted call for these captions.");
      }
      return saveCaption.call({ token: input.token, sessionId: input.sessionId, caption: input.caption }, actor);
    }
    if (input.action === "poll") return (await paradiseRequest(session, { method: "GET", query: { visitor_ref: visitorRef } })).body;
    const body = input.action === "lease"
      ? { visitor_ref: visitorRef, authorized_until_ms: input.authorizedUntilMs }
      : { visitor_ref: visitorRef };
    return (await paradiseRequest(`${session}/${input.action === "queued" ? "start" : input.action}`, { body })).body;
  },
});

export const managedDetails = defineOrchestratedService({
  name: "assistant.managedDetails", summary: "Read this preview's managed settings and cleared Canon talent.",
  kind: "query", permission: "scoped", input: z.object({}),
  output: z.object({
    settings: z.object({ enabled: z.boolean(), talentSlug: z.string(), dailyCapUsd: z.number() }),
    talent: z.array(z.object({ slug: z.string(), name: z.string(), style: z.string() })),
  }),
  handler: async () => {
    const [settings, talent] = await Promise.all([
      paradiseRequest<{ settings: { enabled: boolean; talentSlug: string; dailyCapUsd: number } }>("/v1/ai/assistant/settings", { method: "GET" }),
      paradiseRequest<{ talent: Array<{ slug: string; name: string; style: string }> }>("/v1/ai/assistant/talent", { method: "GET" }),
    ]);
    return { settings: settings.body.settings, talent: talent.body.talent };
  },
});

export const syncManagedSettings = defineOrchestratedService({
  name: "assistant.syncManagedSettings", summary: "Apply an authorized owner's assistant off switch, talent and daily cap at PM.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  input: z.object({ enabled: z.boolean(), talentSlug: z.string().trim().min(1).max(80), dailyCapUsd: z.number().finite().min(0).max(10) }).strict(),
  output: z.object({ settings: z.object({ enabled: z.boolean(), talentSlug: z.string(), dailyCapUsd: z.number() }) }),
  handler: async input => (await paradiseRequest<{ settings: typeof input }>("/v1/ai/assistant/settings", { method: "PATCH", body: input })).body,
});
