// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The optional provider contract, exercised without a network or billable call.
import { describe, expect, it } from "vitest";
import { createOpenAIAltTextSuggester } from "@/adapters/alt-text";

describe("the OpenAI alt-text adapter", () => {
  it("sends a bounded data image to Responses and returns only reviewable text", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const request: typeof fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: 'Alt text: "A cedar cabin beside a still lake."',
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const adapter = createOpenAIAltTextSuggester({
      apiKey: "test-secret",
      model: "vision-test",
      fetch: request,
    });
    const result = await adapter.suggest({
      image: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });

    expect(result).toEqual({
      text: "A cedar cabin beside a still lake.",
      provider: "openai",
      model: "vision-test",
    });
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    if (typeof init?.body !== "string") throw new Error("expected a JSON body");
    const body = JSON.parse(init.body) as {
      store: boolean;
      input: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(body.store).toBe(false);
    expect(body.input[0]!.content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,AQID",
      detail: "low",
    });
  });

  it("does not leak a provider error body", async () => {
    const adapter = createOpenAIAltTextSuggester({
      apiKey: "test-secret",
      model: "vision-test",
      fetch: async () =>
        new Response('{"error":"secret provider detail"}', { status: 401 }),
    });
    await expect(
      adapter.suggest({
        image: new Uint8Array([1]),
        contentType: "image/png",
      }),
    ).rejects.toThrow("HTTP 401");
    await expect(
      adapter.suggest({
        image: new Uint8Array([1]),
        contentType: "image/png",
      }),
    ).rejects.not.toThrow("secret provider detail");
  });

  it("stops reading an oversized provider response", async () => {
    const adapter = createOpenAIAltTextSuggester({
      apiKey: "test-secret",
      model: "vision-test",
      fetch: async () =>
        new Response("x".repeat(256 * 1024 + 1), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      adapter.suggest({
        image: new Uint8Array([1]),
        contentType: "image/png",
      }),
    ).rejects.toThrow("unreadable response");
  });
});
