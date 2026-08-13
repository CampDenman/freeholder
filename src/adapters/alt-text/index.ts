// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Alt-text provider selection. Importing this module makes no network call.
import config from "../../../freeholder.config";
import { env } from "@/core/env";
import { createOpenAIAltTextSuggester } from "@/adapters/alt-text/openai";
import {
  AltTextSuggestionError,
  type AltTextSuggester,
} from "@/adapters/alt-text/types";

function unavailable(id: string, reason: string): AltTextSuggester {
  return {
    id,
    available: false,
    unavailableReason: reason,
    async suggest() {
      throw new AltTextSuggestionError(reason);
    },
  };
}

function build(): AltTextSuggester {
  if (config.adapters.ai === "none") {
    return unavailable(
      "none",
      "Generated alt-text suggestions are not configured for this instance.",
    );
  }
  if (config.adapters.ai !== "openai") {
    return unavailable(
      config.adapters.ai,
      `The ${config.adapters.ai} AI adapter does not yet provide image alt-text suggestions.`,
    );
  }
  const current = env();
  const missing = [
    !current.OPENAI_API_KEY && "OPENAI_API_KEY",
    !current.OPENAI_ALT_TEXT_MODEL && "OPENAI_ALT_TEXT_MODEL",
  ].filter(Boolean);
  if (missing.length > 0) {
    return unavailable(
      "openai",
      `The OpenAI alt-text adapter is missing ${missing.join(" and ")}.`,
    );
  }
  return createOpenAIAltTextSuggester({
    apiKey: current.OPENAI_API_KEY!,
    model: current.OPENAI_ALT_TEXT_MODEL!,
  });
}

let instance: AltTextSuggester | undefined;

export function altTextSuggester(): AltTextSuggester {
  instance ??= build();
  return instance;
}

/** Tests only: inject a deterministic provider without making a paid call. */
export function setAltTextSuggesterForTests(
  suggester: AltTextSuggester | undefined,
): void {
  instance = suggester;
}

export function resetAltTextSuggesterForTests(): void {
  instance = undefined;
}

export type {
  AltTextSuggester,
  AltTextSuggestionInput,
  GeneratedAltText,
} from "@/adapters/alt-text/types";
export { AltTextSuggestionError } from "@/adapters/alt-text/types";
export { createOpenAIAltTextSuggester } from "@/adapters/alt-text/openai";
