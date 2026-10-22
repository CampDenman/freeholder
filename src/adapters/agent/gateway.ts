// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The §37 builder over an OpenAI-compatible chat-completions gateway, used
// only for proposals. Two provider choices share this one wire client:
//
// - `gateway` — any OpenAI-compatible endpoint the owner runs or rents
//   (a hosted router, a self-hosted vLLM/Ollama/LiteLLM, …), configured with
//   AGENT_GATEWAY_URL, AGENT_GATEWAY_API_KEY and AGENT_GATEWAY_MODEL and
//   authenticated with a bearer token.
// - `paradise` — Paradise Modern's hosted gateway, one optional provider
//   among others. It differs only in its defaults (host, model), its
//   `x-api-key` header and a `request_id` correlation field, and keeps its
//   PARADISEMODERN_API_KEY / PARADISEMODERN_URL settings.
//
// `pm_brain`, the old name for the Paradise choice, is accepted as an alias
// (see `normalizeBuilderAgentId`) so existing configurations keep working.
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

/** Paradise Modern's gateway defaults; used only when that provider is chosen. */
export const PARADISE_GATEWAY_DEFAULTS = {
  baseUrl: "https://paradisemodern.com",
  model: "pm-brain:quality",
  credentialRef: "PARADISEMODERN_API_KEY",
} as const;

export type GatewayProvider = "gateway" | "paradise";

/**
 * Old adapter ids still accepted from config, env and stored rows. Reading
 * them keeps working forever; docs call them deprecated.
 */
export const LEGACY_AGENT_ALIASES: Readonly<Record<string, GatewayProvider>> = {
  pm_brain: "paradise",
};

interface GatewayTarget {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  model: string | undefined;
  /** What an owner must set, named in the refusal when something is missing. */
  missing: string[];
}

export function builderGatewayTarget(provider: GatewayProvider): GatewayTarget {
  const current = env();
  if (provider === "paradise") {
    const apiKey = current.PARADISEMODERN_API_KEY;
    return {
      apiKey,
      baseUrl: current.PARADISEMODERN_URL ?? PARADISE_GATEWAY_DEFAULTS.baseUrl,
      model: PARADISE_GATEWAY_DEFAULTS.model,
      missing: apiKey ? [] : ["PARADISEMODERN_API_KEY"],
    };
  }
  const target = {
    apiKey: current.AGENT_GATEWAY_API_KEY,
    baseUrl: current.AGENT_GATEWAY_URL,
    model: current.AGENT_GATEWAY_MODEL,
  };
  return {
    ...target,
    missing: [
      target.baseUrl ? null : "AGENT_GATEWAY_URL",
      target.apiKey ? null : "AGENT_GATEWAY_API_KEY",
      target.model ? null : "AGENT_GATEWAY_MODEL",
    ].filter((name): name is string => name !== null),
  };
}

/** Request headers for one gateway call. */
export function gatewayAuthHeaders(provider: GatewayProvider, apiKey: string): Record<string, string> {
  // Paradise authenticates with a per-site `x-api-key`; OpenAI-compatible
  // gateways take a bearer token.
  return provider === "paradise" ? { "x-api-key": apiKey } : { authorization: `Bearer ${apiKey}` };
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

export function gatewayBuilderAdapter(provider: GatewayProvider): BuilderAgentAdapter {
  return {
    id: provider,
    configured: builderGatewayTarget(provider).missing.length === 0,
    async propose(request: AgentProposalRequest): Promise<AgentProposalResult> {
      const target = builderGatewayTarget(provider);
      if (target.missing.length || !target.apiKey || !target.baseUrl || !target.model) {
        throw new Error(
          `The ${provider === "paradise" ? "Paradise Modern" : "OpenAI-compatible gateway"} builder is selected but ${target.missing.join(", ")} ${target.missing.length === 1 ? "is" : "are"} not configured.`,
        );
      }
      const model = target.model;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      let response: Response;
      try {
        response = await (fetchImpl ?? fetch)(
          `${target.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...gatewayAuthHeaders(provider, target.apiKey),
            },
            body: JSON.stringify({
              model,
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
              ...(provider === "paradise" ? { request_id: request.requestId } : {}),
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
        /** Paradise names the upstream that served the call here. */
        pm_provider?: string;
        /** Several OpenAI-compatible routers name it here. */
        provider?: string;
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
        model: body.model ?? model,
        provider: (typeof body.pm_provider === "string" ? body.pm_provider : null)
          ?? (typeof body.provider === "string" ? body.provider : null),
        usage: usage(body.usage),
      };
    },
  };
}
