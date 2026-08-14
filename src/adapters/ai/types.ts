// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// General bounded generation seam; builder authority remains a separate family.

import type { AdapterStatus } from "../types";

export interface AiGenerationRequest {
  purpose: string;
  system: string;
  input: string;
  maxOutputTokens: number;
  responseSchema?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface AiGenerationResult {
  text?: string;
  structured?: unknown;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface AiAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
}
