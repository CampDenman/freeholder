// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The owner-facing builder is an adapter family of its own (MASTER.md §37).
// Drafting copy and changing a site are different authorities, so this shape
// deliberately shares nothing with adapters/ai.

export interface AgentToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentProposalRequest {
  system: string;
  ownerBrief: string;
  tool: AgentToolDefinition;
  requestId: string;
  maxOutputTokens: number;
}

export interface AgentProposalResult {
  arguments: unknown;
  model: string;
  provider: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface BuilderAgentAdapter {
  readonly id: "pm_brain" | "anthropic" | "openai" | "local" | "none";
  readonly configured: boolean;
  propose(request: AgentProposalRequest): Promise<AgentProposalResult>;
}
