// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern's OpenAI-compatible gateway, used only for §37 proposals.
import { env } from "@/core/env";
import type {
  AgentProposalRequest,
  AgentProposalResult,
  BuilderAgentAdapter,
} from "./types";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | undefined;

export function setBuilderAgentFetchForTests(next: FetchLike | undefined): void {
  fetchImpl = next;
}

function usage(value: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | undefined): AgentProposalResult["usage"] {
  const inputTokens = Math.max(0, value?.prompt_tokens ?? 0);
  const outputTokens = Math.max(0, value?.completion_tokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, value?.total_tokens ?? 0),
  };
}

export function pmBrainAdapter(): BuilderAgentAdapter {
  const current = env();
  return {
    id: "pm_brain",
    configured: Boolean(current.PARADISEMODERN_API_KEY),
    async propose(request: AgentProposalRequest): Promise<AgentProposalResult> {
      const apiKey = env().PARADISEMODERN_API_KEY;
      if (!apiKey) {
        throw new Error("The PM Brain builder is selected but PARADISEMODERN_API_KEY is not configured.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      let response: Response;
      try {
        const base = env().PARADISEMODERN_URL ?? "https://paradisemodern.com";
        response = await (fetchImpl ?? fetch)(
          `${base.replace(/\/+$/, "")}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({
              model: "pm-brain:quality",
              messages: [
                { role: "system", content: request.system },
                { role: "user", content: request.ownerBrief },
              ],
              tools: [request.tool],
              tool_choice: {
                type: "function",
                function: { name: request.tool.function.name },
              },
              parallel_tool_calls: false,
              temperature: 0.2,
              max_tokens: request.maxOutputTokens,
              request_id: request.requestId,
            }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        const message = error instanceof Error && error.name === "AbortError"
          ? "The builder model timed out after two minutes."
          : "The builder model could not be reached.";
        throw new Error(message);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        // Provider response bodies can include request echoes. Never flow one
        // into an owner-visible error or the audit trail.
        throw new Error(`The builder model returned HTTP ${response.status}.`);
      }
      const body = await response.json() as {
        model?: string;
        pm_provider?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const call = body.choices?.[0]?.message?.tool_calls?.find(
        (candidate) => candidate.function?.name === request.tool.function.name,
      );
      if (!call?.function?.arguments) {
        throw new Error("The builder returned no structured proposal.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.function.arguments);
      } catch {
        throw new Error("The builder returned a proposal that was not valid JSON.");
      }
      return {
        arguments: parsed,
        model: body.model ?? "pm-brain:quality",
        provider: body.pm_provider ?? null,
        usage: usage(body.usage),
      };
    },
  };
}
