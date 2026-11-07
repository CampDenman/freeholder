// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managed text uses the same transcript, guardrails and audited turn as other
// assistant providers. PM owns the quote, allowance, exact talent and SFW rules.
import type { AiAdapter } from "@/adapters/ai/types";
import { paradiseRequest } from "./http";

export function createParadiseAssistantAi(): AiAdapter {
  return {
    id: "paradise-assistant",
    status: { family: "ai", id: "paradise-assistant", available: true, message: "Managed site assistant" },
    async generate(request) {
      if (!request.visitorRef || !request.maxChargeCents || request.purpose !== "site-assistant") {
        throw new Error("The managed assistant requires a visitor and a reserved budget.");
      }
      const result = await paradiseRequest<{
        text: string; model: string; metered_list_usd: number; content_mode: string;
      }>("/v1/ai/assistant/text", { body: {
        visitor_ref: request.visitorRef,
        request_id: request.idempotencyKey,
        system: request.system,
        input: request.input,
        max_output_tokens: Math.min(600, request.maxOutputTokens),
        max_charge_usd: request.maxChargeCents / 100,
      }, timeoutMs: 45000 });
      const reply = result.body;
      if (typeof reply.text !== "string" || !reply.text.trim() || reply.content_mode !== "sfw"
          || !Number.isFinite(reply.metered_list_usd) || reply.metered_list_usd < 0
          || reply.metered_list_usd > request.maxChargeCents / 100 + 1e-9) {
        throw new Error("The managed assistant did not return a valid billing receipt.");
      }
      return { text: reply.text, provider: "paradise", model: reply.model,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        meteredCents: Math.ceil(reply.metered_list_usd * 100) };
    },
  };
}
