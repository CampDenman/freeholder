// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import config from "../../../freeholder.config";
import { env } from "@/core/env";
import { pmBrainAdapter } from "./pm-brain";
import type { BuilderAgentAdapter } from "./types";

function unavailable(
  id: Exclude<BuilderAgentAdapter["id"], "pm_brain">,
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
  const selected = env().FREEHOLDER_AGENT ?? config.adapters.agent;
  if (selected === "pm_brain") return pmBrainAdapter();
  return unavailable(selected);
}

export type {
  AgentProposalRequest,
  AgentProposalResult,
  AgentToolDefinition,
  BuilderAgentAdapter,
} from "./types";
