// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: fictional provider responses and private synthetic files.
// These prove no real account/defaults or installed-runtime initialization.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNamespaceOrigin, namespaceOriginInstallation, originCanonical, originSha256, readBucketMetadata, requireReturnedNamespaceOrigin } from "../../packages/cli/src/launch/namespace-origin";
import { SpacesClient } from "../../packages/cli/src/launch/s3";
import { requireInstalledNamespaceOrigin, verifyNamespaceOriginArtifacts } from "@/core/media/quota-namespace-origin";
import { storageNamespace } from "@/core/media/storage-quota";

const endpoint = "https://nyc3.digitaloceanspaces.com", region = "nyc3", accountId = "00000000-0000-4000-8000-000000000101";
const listing = (bucket?: string) => `<ListAllMyBucketsResult><Buckets>${bucket ? `<Bucket><Name>${bucket}</Name><CreationDate>2026-11-14T12:00:00.000Z</CreationDate></Bucket>` : ""}</Buckets></ListAllMyBucketsResult>`;
async function fixture(mode: "created" | "existing" | "missing-request-id" | "lost-return" = "created") {
  const directory = await mkdtemp(join(tmpdir(), "freeholder-fictional-origin-"));
  const calls: string[] = [];
  const origin = await createNamespaceOrigin(directory, { siteName: "fictional-owned-site", accountId, endpoint, region });
  let created = false;
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (init?.method === "PUT") {
      // The durable original request exists before the physical call starts.
      const admission: unknown = JSON.parse(await readFile(join(directory, "admission.json"), "utf8"));
      expect(admission).toHaveProperty("body.binding.bucket", origin.bucket);
      expect(await readFile(join(directory, "dispatch.json"), "utf8")).toContain("requestId");
      created = true;
      if (mode === "lost-return") throw new Error("Fictional provider accepted but its reply was lost");
      return new Response(mode === "existing" ? "<Error><Code>BucketAlreadyOwnedByYou</Code></Error>" : "", { status: mode === "existing" ? 409 : 200, headers: { date: "Sat, 14 Nov 2026 12:00:00 GMT", ...(mode === "missing-request-id" ? {} : { "x-amz-request-id": "fictional-actual-create-request" }) } });
    }
    return new Response(listing(created ? origin.bucket : undefined));
  };
  const spaces = new SpacesClient(endpoint, region, { accessKeyId: "fictional-access", secretAccessKey: "fictional-secret" }, fetcher);
  return { directory, origin, calls, spaces, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
describe("actual one-shot namespace origin source controls", () => {
  it("retains the first unpredictable admission, actual provider metadata/response/FIN and separate installation; a pure verified value grants no runtime scope", async () => {
    const f = await fixture();
    try {
      expect(f.origin.bucket).toMatch(/^fictional-owned-site-media-[a-f0-9]{32}$/);
      await f.origin.create(f.spaces);
      expect(f.calls).toEqual(["GET /", `PUT /${f.origin.bucket}`, "GET /"]);
      const installed = await namespaceOriginInstallation(f.directory, 42), receipt: unknown = JSON.parse(installed.receipt), installation: unknown = JSON.parse(installed.installation);
      const binding = { kind: "s3" as const, namespace: storageNamespace({ id: "s3", endpoint, bucket: f.origin.bucket }), location: { endpoint, bucket: f.origin.bucket } };
      const identity = verifyNamespaceOriginArtifacts({ publicKey: installed.publicKey, receipt, installation, binding });
      expect(identity.receiptDigest).toBe(originSha256(originCanonical(receipt)));
      expect(() => requireInstalledNamespaceOrigin(identity, binding.namespace)).toThrow("privately installed");
      expect((await stat(join(f.directory, "origin-private.pem"))).mode & 0o777).toBe(0o600);
      const before = await readFile(join(f.directory, "receipt.json"), "utf8");
      await expect(f.origin.create(f.spaces)).rejects.toThrow("replayed");
      await requireReturnedNamespaceOrigin(f.directory, f.origin.bucket, { accountId, endpoint, region });
      expect(await readFile(join(f.directory, "receipt.json"), "utf8")).toBe(before);
      expect(f.calls.filter(call => call.startsWith("PUT"))).toHaveLength(1);
    } finally { await f.cleanup(); }
  });
  it.each(["existing", "missing-request-id", "lost-return"] as const)("retains %s as original debt and refuses successful-origin resumption without another PUT", async mode => {
    const f = await fixture(mode);
    try {
      if (mode === "lost-return") await expect(f.origin.create(f.spaces)).rejects.toThrow("reply was lost"); else await f.origin.create(f.spaces);
      const before = await readFile(join(f.directory, "receipt.json"), "utf8");
      await expect(requireReturnedNamespaceOrigin(f.directory, f.origin.bucket, { accountId, endpoint, region })).rejects.toThrow("no complete successful first receipt");
      await expect(createNamespaceOrigin(f.directory, { siteName: "fictional-owned-site", accountId, endpoint, region })).rejects.toThrow("already admitted");
      expect(f.calls.filter(call => call.startsWith("PUT"))).toHaveLength(1);
      expect(await readFile(join(f.directory, "receipt.json"), "utf8")).toBe(before);
    } finally { await f.cleanup(); }
  });
  it("refuses reinstallation on another actual server and preserves the first installation envelope", async () => {
    const f = await fixture();
    try { await f.origin.create(f.spaces); const first = await namespaceOriginInstallation(f.directory, 42); await expect(namespaceOriginInstallation(f.directory, 43)).rejects.toThrow("cannot be rebound"); expect(await readFile(join(f.directory, "installation.json"), "utf8")).toBe(first.installation); }
    finally { await f.cleanup(); }
  });
  it("refuses tampered signed bodies, another verifier, another namespace and another configured bucket before granting any installed scope", async () => {
    const f = await fixture(), other = await fixture();
    try {
      await f.origin.create(f.spaces);
      const installed = await namespaceOriginInstallation(f.directory, 42), receipt: unknown = JSON.parse(installed.receipt), installation: unknown = JSON.parse(installed.installation);
      const binding = { kind: "s3" as const, namespace: storageNamespace({ id: "s3", endpoint, bucket: f.origin.bucket }), location: { endpoint, bucket: f.origin.bucket } };
      const changed: unknown = JSON.parse(installed.receipt.replace('"disposition":"created"', '"disposition":"unknown"'));
      expect(() => verifyNamespaceOriginArtifacts({ publicKey: installed.publicKey, receipt: changed, installation, binding })).toThrow("signature");
      const wrongKey = await readFile(join(other.directory, "origin-public.pem"), "utf8");
      expect(() => verifyNamespaceOriginArtifacts({ publicKey: wrongKey, receipt, installation, binding })).toThrow("signature");
      expect(() => verifyNamespaceOriginArtifacts({ publicKey: installed.publicKey, receipt, installation, binding: { ...binding, namespace: "f".repeat(64) } })).toThrow("exact configured");
      expect(() => verifyNamespaceOriginArtifacts({ publicKey: installed.publicKey, receipt, installation, binding: { ...binding, location: { ...binding.location, bucket: other.origin.bucket } } })).toThrow("exact configured");
    } finally { await f.cleanup(); await other.cleanup(); }
  });
  it("accepts the published DO grammar including an empty account, without inventing an absent provider Owner ID", () => {
    expect(readBucketMetadata("<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>", "fictional")).toMatchObject({ ownerDigest: null, bucket: null });
    expect(readBucketMetadata(listing("fictional-owned"), "fictional-owned").bucket).toEqual({ name: "fictional-owned", createdAt: "2026-11-14T12:00:00.000Z" });
  });
  it.each([
    '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///fictional">]><ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>',
    '<ListAllMyBucketsResult><Buckets><Bucket><Name>fictional</Name><Name>other</Name><CreationDate>2026-11-14T12:00:00Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>',
    '<ListAllMyBucketsResult><Buckets/><IsTruncated>true</IsTruncated></ListAllMyBucketsResult>',
    '<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult><ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>',
    '<ListAllMyBucketsResult><Buckets><Bucket><Name>fictional&#47;other</Name><CreationDate>2026-11-14T12:00:00Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>',
  ])("refuses unsupported/ambiguous metadata without fabricating provider identity", xml => { expect(() => readBucketMetadata(xml, "fictional")).toThrow(); });
});
