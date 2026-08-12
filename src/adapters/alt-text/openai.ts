// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// OpenAI Responses API vision adapter for generated alt-text suggestions.
import {
  AltTextSuggestionError,
  type AltTextSuggester,
  type AltTextSuggestionInput,
} from "@/adapters/alt-text/types";

const MAX_PROVIDER_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const PROMPT = [
  "Write concise, useful alternative text for this image.",
  "Describe only visually supported information that matters to a person who cannot see it.",
  "Do not identify an unknown person, infer sensitive traits, start with 'image of', or add a label.",
  "Return only the proposed alt text in one sentence, no quotation marks, at most 500 characters.",
].join(" ");

interface ResponsesPayload {
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

function normalizeSuggestion(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  text = text.replace(/^alt(?:ernative)? text\s*:\s*/i, "");
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.slice(0, 500).trim();
}

function outputText(payload: ResponsesPayload): string | undefined {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return undefined;
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("response too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function createOpenAIAltTextSuggester(options: {
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}): AltTextSuggester {
  const request = options.fetch ?? globalThis.fetch;
  return {
    id: "openai",
    model: options.model,
    available: true,
    async suggest(input: AltTextSuggestionInput) {
      if (input.image.byteLength > MAX_PROVIDER_IMAGE_BYTES) {
        throw new AltTextSuggestionError(
          "The safe preview is too large to send for a suggestion.",
        );
      }
      let response: Response;
      try {
        response = await request("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            store: false,
            max_output_tokens: 180,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: PROMPT },
                  {
                    type: "input_image",
                    image_url: `data:${input.contentType};base64,${Buffer.from(input.image).toString("base64")}`,
                    detail: "low",
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new AltTextSuggestionError(
          "The alt-text provider could not be reached. Try again in a moment.",
        );
      }
      if (!response.ok) {
        throw new AltTextSuggestionError(
          `The alt-text provider refused the request (HTTP ${response.status}). Check its key, model and usage limits.`,
        );
      }
      let payload: ResponsesPayload;
      try {
        const raw = await boundedResponseText(response);
        payload = JSON.parse(raw) as ResponsesPayload;
      } catch {
        throw new AltTextSuggestionError(
          "The alt-text provider returned an unreadable response.",
        );
      }
      const text = normalizeSuggestion(outputText(payload) ?? "");
      if (!text) {
        throw new AltTextSuggestionError(
          "The alt-text provider returned no usable suggestion.",
        );
      }
      return { text, provider: "openai", model: options.model };
    },
  };
}
