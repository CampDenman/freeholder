// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// OpenAI-compatible generation adapter (C9.21, MASTER.md §31, §12).
//
// One implementation, several providers. The chat-completions wire format is
// what OpenAI itself speaks and what every hosted gateway that wants to be
// dropped into an existing app speaks — including the model providers a
// platform host bills through its own account. §31 wants the Replit recipe to
// have a working assistant minutes after deploy without a second signup, and
// the way that actually happens is a base URL and a key the host already
// provides, not a bespoke adapter per host.
//
// So `baseUrl` is a first-class setting rather than a test seam.
import { AdapterError, unavailable, type AdapterStatus } from "../types";
import { extractJson } from "./anthropic";
import type { AiAdapter, AiGenerationRequest, AiGenerationResult } from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com";
const REQUEST_TIMEOUT_MS = 30_000;

export interface OpenAiCompatibleOptions {
  apiKey?: string | undefined;
  model?: string | null;
  baseUrl?: string | null;
  fetchImpl?: typeof fetch;
}

export function createOpenAiAi(options: OpenAiCompatibleOptions = {}): AiAdapter {
  const configured = Boolean(options.apiKey?.trim());
  const status: AdapterStatus = {
    family: "ai",
    id: "openai",
    available: configured,
    message: configured
      ? "An OpenAI-compatible key is configured."
      : "No OpenAI-compatible key is set in this environment.",
  };

  return {
    id: "openai",
    status,
    async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        throw unavailable(
          "ai",
          "openai",
          "No OpenAI-compatible key is set in this environment.",
        );
      }
      const model = options.model?.trim();
      if (!model) {
        throw new AdapterError(
          "ai",
          "openai",
          "invalid_request",
          "No model is chosen, so there is nothing to ask.",
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        const base = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
        response = await (options.fetchImpl ?? fetch)(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: request.maxOutputTokens,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.input },
            ],
            ...(request.responseSchema
              ? { response_format: { type: "json_object" } }
              : {}),
            user: request.idempotencyKey,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new AdapterError(
          "ai",
          "openai",
          "provider_failure",
          error instanceof Error && error.name === "AbortError"
            ? "The model did not answer in time."
            : "The model could not be reached.",
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new AdapterError(
          "ai",
          "openai",
          response.status === 401 || response.status === 403
            ? "authentication"
            : response.status === 429
              ? "rate_limited"
              : "provider_failure",
          `The model returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500,
          String(response.status),
        );
      }

      const body = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      const inputTokens = Math.max(0, body.usage?.prompt_tokens ?? 0);
      const outputTokens = Math.max(0, body.usage?.completion_tokens ?? 0);
      return {
        text,
        structured: request.responseSchema ? extractJson(text) : undefined,
        provider: "openai",
        model: body.model ?? model,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
    },
  };
}
