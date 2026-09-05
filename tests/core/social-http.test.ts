// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { socialJson } from "@/adapters/social/http";
import { downloadSocialMedia } from "@/adapters/social/media";

let server: Server | undefined;

async function listen(
  handler: RequestListener,
): Promise<string> {
  server = createServer(handler);
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("social provider HTTP boundaries", () => {
  it("stops reading oversized provider JSON", async () => {
    const response = new Response(new Uint8Array(256 * 1024 + 1));
    await expect(socialJson(response, "instagram")).rejects.toThrow(
      /oversized response/,
    );
  });

  it("downloads media without credentials and preserves the original Host", async () => {
    let authorization: string | undefined;
    let host: string | undefined;
    const base = await listen((request, response) => {
      authorization = request.headers.authorization;
      host = request.headers.host;
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([1, 2, 3]));
    });

    const bytes = await downloadSocialMedia("instagram", `${base}/image.png`, {
      allowLocal: true,
    });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(authorization).toBeUndefined();
    expect(host).toBe(new URL(base).host);
  });

  it("does not follow media redirects", async () => {
    let requests = 0;
    const base = await listen((_request, response) => {
      requests += 1;
      response.writeHead(302, { location: "/secret" });
      response.end();
    });

    await expect(
      downloadSocialMedia("instagram", `${base}/image.png`, { allowLocal: true }),
    ).rejects.toThrow(/HTTP 302/);
    expect(requests).toBe(1);
  });

  it("rejects oversized media before retaining it", async () => {
    const base = await listen((_request, response) => {
      response.writeHead(200, { "content-length": "4" });
      response.end(Buffer.from([1, 2, 3, 4]));
    });

    await expect(
      downloadSocialMedia("instagram", `${base}/image.png`, {
        allowLocal: true,
        maxBytes: 3,
      }),
    ).rejects.toThrow(/oversized media/);
  });

  it("refuses private DNS answers in the production policy", async () => {
    await expect(
      downloadSocialMedia("instagram", "https://media.example/image.png", {
        allowLocal: false,
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow(/could not be reached safely/);
  });
});
