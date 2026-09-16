// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public inbound from quote, chat and tip blocks (C2.09).
//
// Each path resolves the unified contact and emits an event. None of them
// invents a module-private customer.
import { z } from "zod";
import { createHash } from "node:crypto";
import { okResult, row, uuid } from "@/core/contract";
import { defineService, getService } from "@/core/service";
import { resolveContact } from "@/core/contacts/service";

const email = z.string().trim().email().toLowerCase();
const name = z.string().trim().min(1).max(200);
const message = z.string().trim().min(1).max(4000);

export const submitQuoteRequest = defineService({
  name: "cms.submitQuoteRequest",
  summary: "A visitor asks for a quote; land them on the contact spine.",
  kind: "mutation",
  permission: "public",
  input: z.object({ name, email, message }),
  output: okResult,
  handler: async (input, ctx) => {
    const resolved = await ctx.callAsSystem(resolveContact, {
      name: input.name,
      email: input.email,
      source: "quote-request",
    });
    ctx.setSubject("contact", resolved.contact.id);
    ctx.queueEvent("cms.quoteRequested", {
      contactId: resolved.contact.id,
      message: input.message,
    });
    return { ok: true as const };
  },
});

export const submitSiteChat = defineService({
  name: "cms.submitSiteChat",
  summary: "A visitor starts a live chat on their canonical Contact conversation.",
  kind: "mutation",
  permission: "public",
  writeClass: "message",
  input: z.object({
    name,
    email,
    message,
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .default("en"),
  }),
  rateLimit: {
    limit: 5,
    windowSeconds: 60 * 60,
    subject: (input) => createHash("sha256").update(input.email, "utf8").digest("hex"),
    message: "Wait before starting another chat with this email address.",
  },
  output: row({ ok: z.literal(true), token: z.string(), conversationId: uuid, contactId: uuid }),
  handler: async (input, ctx) => {
    const started = (await ctx.call(getService("messaging.startSiteChat"), input)) as {
      ok: true;
      token: string;
      conversationId: string;
      contactId: string;
    };
    ctx.setSubject("conversation", started.conversationId);
    ctx.queueEvent("cms.siteChatStarted", {
      conversationId: started.conversationId,
      contactId: started.contactId,
    });
    return started;
  },
});

export const submitTipIntent = defineService({
  name: "cms.submitTipIntent",
  summary: "Record a tip the owner still has to collect — not a payment.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    email,
    name: name.optional(),
    amountMinor: z.number().int().positive().max(100_000_000),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    message: z.string().trim().max(400).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const resolved = await ctx.callAsSystem(resolveContact, {
      name: input.name ?? input.email,
      email: input.email,
      source: "tip",
    });
    ctx.setSubject("contact", resolved.contact.id);
    ctx.queueEvent("cms.tipIntended", {
      contactId: resolved.contact.id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      message: input.message ?? null,
    });
    return { ok: true as const };
  },
});
