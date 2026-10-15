// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PM Brain generation adapter (C3.33, MASTER.md §31, §12).
//
// The same OpenAI-compatible wire format as `openai.ts`, authenticated the
// way the §37 builder already authenticates to the same gateway: the site
// key in `x-api-key`, the billing project in `x-pm-project`, and an optional
// fallback policy. The model is a PM lane (`pm-brain`, `pm-brain:quality`…),
// never an upstream model name — PM chooses the provider behind it.
//
// Optional, like every adapter here: nothing selects it unless an owner sets
// `adapters.ai` to `pm_brain` or picks it for the assistant.
import { paradiseBaseUrl, pmBrainGatewayHeaders, PM_BRAIN_DEFAULT_MODEL } from "../paradise/config";
import { AdapterError, unavailable, type AdapterStatus } from "../types";
import { chatCompletions } from "./openai";
import type { AiAdapter, AiGenerationRequest, AiGenerationResult } from "./types";

export interface PmBrainAiOptions {
  apiKey?: string | undefined;
  /** A PM lane. Defaults to the balanced `pm-brain` lane. */
  model?: string | null;
  baseUrl?: string | null;
  /** Billing project slug registered in PM. Defaults to the environment's. */
  project?: string | null;
  fallbackPolicy?: string | null;
  fetchImpl?: typeof fetch;
}

export function createPmBrainAi(options: PmBrainAiOptions = {}): AiAdapter {
  const configured = Boolean(options.apiKey?.trim());
  const status: AdapterStatus = {
    family: "ai",
    id: "pm_brain",
    available: configured,
    message: configured
      ? "PM Brain is configured."
      : "No Paradise Modern site key is set in this environment.",
  };

  return {
    id: "pm_brain",
    status,
    async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        throw unavailable("ai", "pm_brain", "No Paradise Modern site key is set in this environment.");
      }
      const headers = pmBrainGatewayHeaders(apiKey, {
        project: options.project,
        fallbackPolicy: options.fallbackPolicy,
      });
      if (!headers["x-pm-project"]) {
        // PM would answer 400 unknown_project. Saying so here names the fix.
        throw new AdapterError(
          "ai",
          "pm_brain",
          "invalid_request",
          "PM Brain needs a billing project: set PARADISEMODERN_BILLING_PROJECT to a slug registered in Paradise Modern.",
        );
      }
      return chatCompletions({
        adapterId: "pm_brain",
        url: `${paradiseBaseUrl(options.baseUrl ?? undefined)}/v1/chat/completions`,
        headers,
        model: options.model?.trim() || PM_BRAIN_DEFAULT_MODEL,
        request,
        fetchImpl: options.fetchImpl,
        // PM's own idempotency field; `user` stays for OpenAI-shaped logs.
        extraBody: { request_id: request.idempotencyKey },
      });
    },
  };
}
