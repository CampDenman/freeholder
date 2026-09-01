// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Anthropic Messages API generation adapter (C9.21, MASTER.md §31, §12).
//
// Raw HTTP, like every other adapter in this codebase: the vendor boundary
// carries no vendor SDK (§2 principle 5). This is the *generation* family —
// one bounded request, one bounded answer — and it deliberately shares nothing
// with `adapters/agent`, whose workforce adapters run a tool loop with far more
// authority.
//
// Structured output is asked for in the system prompt rather than through a
// provider feature, because `AiGenerationRequest.responseSchema` has to mean
// the same thing on every provider the owner might pick. The caller must still
// validate what comes back: a model asked for JSON is a model that usually
// returns JSON, which is not the same as a guarantee.
import { AdapterError, unavailable, type AdapterStatus } from "../types";
import type { AiAdapter, AiGenerationRequest, AiGenerationResult } from "./types";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * No default model.
 *
 * Guessing one is how an instance silently pins itself to whatever was current
 * the day this file was written, and then bills an owner for it. The settings
 * that select this adapter require a model to be named.
 */
export interface AnthropicAiOptions {
  apiKey?: string | undefined;
  model?: string | null;
  baseUrl?: string | null;
  /** Only the tests replace this; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

function jsonInstruction(schema: Record<string, unknown>): string {
  return `\n\nReply with a single JSON object and nothing else — no prose before it, no code fence around it. It must match this JSON Schema:\n${JSON.stringify(schema)}`;
}

/** The first balanced JSON object in a reply, so a stray sentence is survivable. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export function createAnthropicAi(options: AnthropicAiOptions = {}): AiAdapter {
  const configured = Boolean(options.apiKey?.trim());
  const status: AdapterStatus = {
    family: "ai",
    id: "anthropic",
    available: configured,
    message: configured
      ? "Anthropic is configured."
      : "No Anthropic key is set in this environment.",
  };

  return {
    id: "anthropic",
    status,
    async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        throw unavailable("ai", "anthropic", "No Anthropic key is set in this environment.");
      }
      const model = options.model?.trim();
      if (!model) {
        throw new AdapterError(
          "ai",
          "anthropic",
          "invalid_request",
          "No Anthropic model is chosen, so there is nothing to ask.",
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        const base = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
        response = await (options.fetchImpl ?? fetch)(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: request.maxOutputTokens,
            system: request.responseSchema
              ? `${request.system}${jsonInstruction(request.responseSchema)}`
              : request.system,
            messages: [{ role: "user", content: request.input }],
            metadata: { user_id: request.idempotencyKey },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new AdapterError(
          "ai",
          "anthropic",
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
        // A provider body can echo the request, and the request contains a
        // visitor's words. Only the status code is safe to keep.
        throw new AdapterError(
          "ai",
          "anthropic",
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
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (body.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
      const inputTokens = Math.max(0, body.usage?.input_tokens ?? 0);
      const outputTokens = Math.max(0, body.usage?.output_tokens ?? 0);
      return {
        text,
        structured: request.responseSchema ? extractJson(text) : undefined,
        provider: "anthropic",
        model: body.model ?? model,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
    },
  };
}
