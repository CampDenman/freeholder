// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyManifestObjects, createS3Store } from "../../scripts/media-transfer.mjs";

const config = {
  SOURCE_S3_ENDPOINT: "https://storage.example.invalid",
  SOURCE_S3_REGION: "nyc3",
  SOURCE_S3_BUCKET: "synthetic-private-fixture",
  SOURCE_S3_ACCESS_KEY_ID: "synthetic-key",
  SOURCE_S3_SECRET_ACCESS_KEY: "synthetic-secret",
};

afterEach(() => vi.unstubAllGlobals());

// Construct the rejected userinfo fixture with URL's actual credential fields.
// No credential-bearing URI literal belongs in source or scanner history.
const userinfoFixture = new URL(config.SOURCE_S3_ENDPOINT);
userinfoFixture.username = "fixture-user";
userinfoFixture.password = "fixture-password";

describe("migration S3 transport", () => {
  it.each([
    "http://storage.example", "http://127.0.0.1:9999", "ftp://storage.example",
    userinfoFixture.href, "https://storage.example/?token=x",
    "https://storage.example/#fragment",
  ])("refuses unsafe endpoint %s before fetching", (endpoint) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() => createS3Store({ ...config, SOURCE_S3_ENDPOINT: endpoint }, "SOURCE")).toThrow(/HTTPS/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits explicit HTTP fixture support to loopback", () => {
    expect(() => createS3Store({ ...config, SOURCE_S3_ENDPOINT: "http://127.0.0.1:9999", SOURCE_S3_ALLOW_LOOPBACK_HTTP: "true" }, "SOURCE")).not.toThrow();
    expect(() => createS3Store({ ...config, SOURCE_S3_ENDPOINT: "http://storage.example", SOURCE_S3_ALLOW_LOOPBACK_HTTP: "true" }, "SOURCE")).toThrow(/HTTPS/);
  });

  it.each([".", "..", "a/../private", "a/./object", "", "a\0b"])("rejects unsafe key %s before any manifest write", async (key) => {
    const source = { get: vi.fn(async () => new Uint8Array([1])), put: vi.fn() };
    const target = { get: vi.fn(), put: vi.fn() };
    await expect(copyManifestObjects({
      manifest: { format: "freeholder-media-manifest/v1", objects: [{ key: "valid", bytes: 1 }, { key, bytes: 1 }] },
      source, target,
    })).rejects.toThrow(/dot path|NUL|empty/);
    expect(source.get).not.toHaveBeenCalled();
    expect(target.put).not.toHaveBeenCalled();
  });

  it.each(["path", "virtual"])("preserves literal percent-encoded-looking keys with %s addressing", async (style) => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(new Uint8Array([1]), { status: 200 });
    }));
    const store = createS3Store({ ...config, SOURCE_S3_ADDRESSING_STYLE: style }, "SOURCE");
    await store.get("folder/%2e%2e/space name.txt");
    await store.put("folder/%2e%2e/space name.txt", new Uint8Array([1]), "application/octet-stream");
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.redirect).toBe("error");
      expect(new URL(request.url).pathname).toContain("/folder/%252e%252e/space%20name.txt");
      expect(new URL(request.url).hostname).toBe(style === "virtual"
        ? "synthetic-private-fixture.storage.example.invalid" : "storage.example.invalid");
      expect(request.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    }
  });
});
