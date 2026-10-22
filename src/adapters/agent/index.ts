// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import config from "../../../freeholder.config";
import { env } from "@/core/env";
import { gatewayBuilderAdapter } from "./gateway";
import type { BuilderAgentAdapter } from "./types";

function unavailable(
  id: Exclude<BuilderAgentAdapter["id"], "gateway" | "paradise">,
): BuilderAgentAdapter {
  return {
    id,
    configured: id === "none",
    async propose() {
      throw new Error(
        id === "none"
          ? "The owner-facing builder is disabled for this instance."
          : `The ${id} builder adapter is selected but is not installed in this build.`,
      );
    },
  };
}

export function builderAgent(): BuilderAgentAdapter {
  // Both sources already map the deprecated `pm_brain` alias to `paradise`.
  const selected = env().FREEHOLDER_AGENT ?? config.adapters.agent;
  if (selected === "gateway" || selected === "paradise") return gatewayBuilderAdapter(selected);
  return unavailable(selected);
}

export type {
  AgentProposalRequest,
  AgentProposalResult,
  AgentToolDefinition,
  BuilderAgentAdapter,
} from "./types";
