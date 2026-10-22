// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The managed workforce runtime contract (MASTER.md §40, C4.05).
//
// A *managed* connection means the platform runs the agent loop itself: core
// composes the conversation, the adapter makes exactly one model turn, and
// core decides what happens to every tool call the model asks for. That split
// is deliberate — providers differ in wire format, but the loop's safety
// properties (the write gate, limits, budgets, redaction) must not, so they
// live in core and this interface stays a dumb, provider-shaped seam.
//
// Distinct from `BuilderAgentAdapter` in ./types.ts: §37's builder proposes
// one structured change and carries site-changing authority; a workforce turn
// is a step in a bounded loop under a worker's own scopes. Sharing an
// interface would invite sharing authority.

import { normalizeAgentProviderId } from "./aliases";
import type { AgentToolDefinition } from "./types";

export interface WorkforceToolCall {
  /** Provider-issued id, echoed back on the matching tool result. */
  id: string;
  name: string;
  /** Parsed JSON arguments. Invalid provider JSON fails the turn, not core. */
  arguments: unknown;
}

export type WorkforceMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: WorkforceToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface WorkforceTurnRequest {
  model: string;
  system: string;
  messages: WorkforceMessage[];
  tools: AgentToolDefinition[];
  maxOutputTokens: number;
  /** Correlates provider requests with the run in provider-side logs. */
  requestId: string;
}

export interface WorkforceTurnResult {
  text: string | null;
  toolCalls: WorkforceToolCall[];
  /** What the provider says actually served the turn. */
  model: string;
  stop: "end" | "tool_calls" | "length";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * `gateway` is any OpenAI-compatible endpoint (base URL and model named on
 * the connection); `paradise` is Paradise Modern's hosted gateway, one
 * optional provider among others.
 */
export const WORKFORCE_ADAPTER_IDS = [
  "anthropic",
  "openai",
  "gateway",
  "paradise",
] as const;

export type WorkforceAdapterId = (typeof WORKFORCE_ADAPTER_IDS)[number];

/**
 * Maps a deprecated adapter name (see ./aliases) to its current id; anything
 * else passes through. Stored rows are aliased on read, never rewritten.
 */
export function normalizeWorkforceAdapterId(value: string): string;
export function normalizeWorkforceAdapterId(value: string | null): string | null;
export function normalizeWorkforceAdapterId(value: string | null): string | null {
  return value === null ? null : normalizeAgentProviderId(value);
}

export interface WorkforceAgentAdapter {
  readonly id: WorkforceAdapterId | "none";
  /** The credential named by the connection resolves to a real value. */
  readonly configured: boolean;
  /** Which environment variable the connection expects; doctor names it. */
  readonly credentialRef: string | null;
  /** The model a turn will use when the connection does not name one. */
  readonly defaultModel: string | null;
  /** Every setting an unconfigured adapter still needs; doctor names them all. */
  readonly missing?: readonly string[];
  turn(request: WorkforceTurnRequest): Promise<WorkforceTurnResult>;
}

/** What the selection function needs to know about a connection. */
export interface WorkforceConnectionConfig {
  adapter: string | null;
  model: string | null;
  credentialRef: string | null;
  baseUrl: string | null;
}
