// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Anthropic Messages API workforce adapter (C4.05).
//
// Raw HTTP on purpose: adapters are this codebase's vendor boundary (§2
// principle 5) and none of them carries a provider SDK — the mail, payments
// and builder adapters all speak wire format directly, so this one does too.
import type { AgentToolDefinition } from "./types";
import type {
  WorkforceAgentAdapter,
  WorkforceMessage,
  WorkforceToolCall,
  WorkforceTurnRequest,
  WorkforceTurnResult,
} from "./workforce-types";

const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5";
const TURN_TIMEOUT_MS = 180_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | undefined;

export function setWorkforceAnthropicFetchForTests(next: FetchLike | undefined): void {
  fetchImpl = next;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[] | string;
}

/**
 * The neutral transcript, in Anthropic shape. Consecutive tool results merge
 * into one user turn: parallel tool calls must come back in a single message
 * or the model quietly learns to stop making them.
 */
export function toAnthropicMessages(messages: WorkforceMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
        });
      }
      out.push({
        role: "assistant",
        content: blocks.length ? blocks : [{ type: "text", text: "" }],
      });
      continue;
    }
    const block: AnthropicContentBlock = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
    };
    const last = out.at(-1);
    if (last?.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

function toAnthropicTools(tools: AgentToolDefinition[]): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

export function anthropicWorkforceAdapter(options: {
  apiKey: string | undefined;
  credentialRef: string | null;
  baseUrl: string | null;
  model: string | null;
}): WorkforceAgentAdapter {
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  return {
    id: "anthropic",
    configured: Boolean(options.apiKey),
    credentialRef: options.credentialRef,
    defaultModel: model,
    async turn(request: WorkforceTurnRequest): Promise<WorkforceTurnResult> {
      if (!options.apiKey) {
        throw new Error(
          `The Anthropic workforce adapter is selected but ${options.credentialRef ?? "ANTHROPIC_API_KEY"} is not set.`,
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
      let response: Response;
      try {
        const base = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
        response = await (fetchImpl ?? fetch)(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: toAnthropicMessages(request.messages),
            ...(request.tools.length ? { tools: toAnthropicTools(request.tools) } : {}),
            metadata: { user_id: request.requestId },
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
        // Provider bodies can echo the request. Never let one into an error an
        // owner sees or a step the run records.
        throw new Error(`The workforce model returned HTTP ${response.status}.`);
      }
      const body = (await response.json()) as {
        model?: string;
        stop_reason?: string;
        content?: Array<{
          type?: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (body.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
      const toolCalls: WorkforceToolCall[] = (body.content ?? [])
        .filter((block) => block.type === "tool_use" && block.id && block.name)
        .map((block) => ({
          id: block.id!,
          name: block.name!,
          arguments: block.input ?? {},
        }));
      const inputTokens = Math.max(0, body.usage?.input_tokens ?? 0);
      const outputTokens = Math.max(0, body.usage?.output_tokens ?? 0);
      return {
        text: text.length ? text : null,
        toolCalls,
        model: body.model ?? request.model,
        stop:
          body.stop_reason === "tool_use"
            ? "tool_calls"
            : body.stop_reason === "max_tokens"
              ? "length"
              : "end",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    },
  };
}
