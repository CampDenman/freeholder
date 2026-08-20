// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// OpenAI-compatible workforce adapter (C4.05): OpenAI itself, and Paradise
// Modern's gateway, which speaks the same chat-completions wire format with a
// different host, auth header and token-limit field. Raw HTTP like every
// other adapter — the vendor boundary carries no vendor SDK.
import type {
  WorkforceAdapterId,
  WorkforceAgentAdapter,
  WorkforceMessage,
  WorkforceToolCall,
  WorkforceTurnRequest,
  WorkforceTurnResult,
} from "./workforce-types";

// OpenAI has no default here on purpose: guessing a model id is how a
// connection silently pins itself to whatever was current when this file was
// written. The connect service requires the owner to name one.
export const PM_BRAIN_DEFAULT_MODEL = "pm-brain:quality";
const TURN_TIMEOUT_MS = 180_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | undefined;

export function setWorkforceOpenAiFetchForTests(next: FetchLike | undefined): void {
  fetchImpl = next;
}

type WireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export function toChatMessages(system: string, messages: WorkforceMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments ?? {}),
                },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", content: message.content, tool_call_id: message.toolCallId });
    }
  }
  return out;
}

export function openAiCompatibleWorkforceAdapter(options: {
  id: Extract<WorkforceAdapterId, "openai" | "pm_brain">;
  apiKey: string | undefined;
  credentialRef: string | null;
  baseUrl: string | null;
  model: string | null;
}): WorkforceAgentAdapter {
  const gateway = options.id === "pm_brain";
  const model = options.model ?? (gateway ? PM_BRAIN_DEFAULT_MODEL : null);
  return {
    id: options.id,
    configured: Boolean(options.apiKey),
    credentialRef: options.credentialRef,
    defaultModel: model,
    async turn(request: WorkforceTurnRequest): Promise<WorkforceTurnResult> {
      if (!options.apiKey) {
        throw new Error(
          `The ${options.id} workforce adapter is selected but ${options.credentialRef ?? "its API key"} is not set.`,
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
      let response: Response;
      try {
        const base = (
          options.baseUrl ??
          (gateway ? "https://paradisemodern.com" : "https://api.openai.com")
        ).replace(/\/+$/, "");
        response = await (fetchImpl ?? fetch)(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // The gateway authenticates like the §37 builder does; OpenAI
            // itself takes a bearer token.
            ...(gateway
              ? { "x-api-key": options.apiKey }
              : { authorization: `Bearer ${options.apiKey}` }),
          },
          body: JSON.stringify({
            model: request.model,
            messages: toChatMessages(request.system, request.messages),
            ...(request.tools.length ? { tools: request.tools } : {}),
            parallel_tool_calls: true,
            ...(gateway
              ? { max_tokens: request.maxOutputTokens, request_id: request.requestId }
              : { max_completion_tokens: request.maxOutputTokens }),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new Error(
          error instanceof Error && error.name === "AbortError"
            ? "The workforce model timed out after three minutes."
            : "The workforce model could not be reached.",
        );
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        // Provider bodies can echo the request; keep them out of owner-visible
        // errors and recorded steps.
        throw new Error(`The workforce model returned HTTP ${response.status}.`);
      }
      const body = (await response.json()) as {
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        choices?: Array<{
          finish_reason?: string;
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const choice = body.choices?.[0];
      const toolCalls: WorkforceToolCall[] = [];
      for (const call of choice?.message?.tool_calls ?? []) {
        if (!call.id || !call.function?.name) continue;
        let parsed: unknown = {};
        try {
          parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          throw new Error("The workforce model returned tool arguments that were not valid JSON.");
        }
        toolCalls.push({ id: call.id, name: call.function.name, arguments: parsed });
      }
      const inputTokens = Math.max(0, body.usage?.prompt_tokens ?? 0);
      const outputTokens = Math.max(0, body.usage?.completion_tokens ?? 0);
      return {
        text: choice?.message?.content?.length ? choice.message.content : null,
        toolCalls,
        model: body.model ?? request.model,
        stop:
          choice?.finish_reason === "tool_calls" || toolCalls.length
            ? "tool_calls"
            : choice?.finish_reason === "length"
              ? "length"
              : "end",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: Math.max(inputTokens + outputTokens, body.usage?.total_tokens ?? 0),
        },
      };
    },
  };
}
