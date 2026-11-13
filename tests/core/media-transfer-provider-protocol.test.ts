// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: provider-shaped local controls, not account acceptance.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createS3TransferProtocol, createReplitTransferProtocol } from "../../scripts/media-transfer-protocol.mjs";
import type { TransferRequestDescriptor, TransferRequestObservation, TransferRequestObserver } from "../../scripts/media-transfer.mjs";

const s3 = { kind: "s3" as const, namespace: "a".repeat(64), location: { bucket: "original-media" } };
const replit = { kind: "replit" as const, namespace: "b".repeat(64), location: { bucket: "original-private-bucket" } };
const key = "private/original.bin", bytes = new Uint8Array([0, 255, 13, 10, 128, 0]);
const checksum = createHash("sha256").update(bytes).digest("hex");
function ledger() {
  const requests: Array<{ descriptor: TransferRequestDescriptor; facts: TransferRequestObservation[]; returned: boolean }> = [];
  const observer: TransferRequestObserver = async (descriptor, operation) => {
    const row = { descriptor, facts: [] as TransferRequestObservation[], returned: false }; requests.push(row);
    const result = await operation(async facts => { row.facts.push(facts); }); row.returned = true; return result;
  };
  return { observer, requests };
}
function s3Store(request: typeof fetch, observer?: TransferRequestObserver) {
  return createS3TransferProtocol({ client: { fetch: request }, binding: s3, url: value => `https://storage.example.test/original-media/${value.split("/").map(encodeURIComponent).join("/")}`, observer });
}
const list = (kind: "objects" | "versions" | "sessions", body: string, more = "false") => `<${kind === "objects" ? "ListBucketResult" : kind === "versions" ? "ListVersionsResult" : "ListMultipartUploadsResult"}><${kind === "objects" ? "Name" : "Bucket"}>original-media</${kind === "objects" ? "Name" : "Bucket"}><EncodingType>url</EncodingType><IsTruncated>${more}</IsTruncated>${kind === "objects" ? "<KeyCount>1</KeyCount>" : ""}${body}</${kind === "objects" ? "ListBucketResult" : kind === "versions" ? "ListVersionsResult" : "ListMultipartUploadsResult"}>`;

describe("C1.12/C11.08 actual provider protocol boundaries", () => {
  it("retains actual S3 metadata and complete exact binary-body SHA in one physical request", async () => {
    const journal = ledger(), request = vi.fn(async () => new Response(bytes, { headers: { etag: '"original-etag"', "x-amz-version-id": "original-version", "content-type": "application/octet-stream" } }));
    const result = await s3Store(request, journal.observer).readVersioned(key);
    expect(result?.body).toEqual(bytes); expect(result?.revision.versionId).toBe("original-version");
    expect(journal.requests).toHaveLength(1); expect(journal.requests[0]?.returned).toBe(true);
    expect(journal.requests[0]?.facts.at(-1)).toMatchObject({ stage: "body", sha256: checksum, bytes: bytes.byteLength, status: 200 });
  });
  it("retains original S3 version identity in conditional retirement without fallback", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 412 })), store = s3Store(request);
    await expect(store.deleteVersioned(key, { kind: "etag", key, namespace: s3.namespace, value: '"original-etag"', versionId: "original+/version" })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input.toString());
    expect(url.searchParams.get("versionId")).toBe("original+/version");
    expect(url.pathname).toBe("/original-media/private/original.bin");
    expect(new Headers(init?.headers).get("if-match")).toBe('"original-etag"');
    expect(init?.method).toBe("DELETE");
  });
  it("enumerates retained S3 versions, delete markers and multipart sessions separately", async () => {
    const bodies = [list("versions", `<Version><Key>private%2Foriginal.bin</Key><VersionId>original-version</VersionId><IsLatest>false</IsLatest><ETag>&quot;original-etag&quot;</ETag><Size>6</Size></Version><DeleteMarker><Key>private%2Foriginal.bin</Key><VersionId>delete-marker</VersionId><IsLatest>true</IsLatest></DeleteMarker>`), list("sessions", `<Upload><Key>private%2Foriginal.bin</Key><UploadId>unassigned-session</UploadId></Upload>`)], journal = ledger();
    const request = vi.fn(async () => new Response(bodies.shift())), store = s3Store(request, journal.observer);
    const versions = await store.inventoryPage("versions"), sessions = await store.inventoryPage("sessions");
    expect(versions.entries.map(row => row.kind)).toEqual(["version", "delete_marker"]);
    expect(versions.entries[0]?.revision?.versionId).toBe("original-version"); expect(versions.entries[1]?.revision).toBeUndefined();
    expect(sessions.entries[0]).toMatchObject({ kind: "session", key, sessionId: "unassigned-session" });
    expect(journal.requests.every(row => row.returned && row.facts.some(fact => fact.stage === "inventory_raw"))).toBe(true);
  });
  it("retains the actual accepted S3 PUT even when its returned revision is unusable", async () => {
    const journal = ledger(), request = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(s3Store(request, journal.observer).put(key, bytes, "application/octet-stream")).rejects.toThrow();
    expect(journal.requests[0]?.returned).toBe(false); expect(journal.requests[0]?.facts.some(fact => fact.stage === "accepted")).toBe(true);
  });
  for (const bad of ["<!DOCTYPE x [<!ENTITY hidden 'bytes'>]><ListBucketResult/>", list("objects", "<Contents><Key>private%2Foriginal.bin</Key><Size>6</Size><ETag>&quot;tag&quot;</ETag></Contents>").replace("<KeyCount>1</KeyCount>", "<KeyCount>0</KeyCount>"), list("versions", "", "true")]) it("refuses malformed, contradictory or unresumable S3 inventory", async () => {
    const journal = ledger();
    await expect(s3Store(vi.fn(async () => new Response(bad)), journal.observer).inventoryPage(bad.includes("ListVersionsResult") ? "versions" : "objects")).rejects.toThrow();
    expect(journal.requests[0]?.returned).toBe(false); expect(journal.requests[0]?.facts.some(fact => fact.stage === "inventory_raw")).toBe(true);
  });
  it("records Replit metadata and pinned binary body as distinct original requests", async () => {
    const journal = ledger(), calls: Array<{ name: string; options: unknown }> = [];
    const metadata = { name: key, bucket: replit.location.bucket, generation: "18446744073709551615", size: "6", contentType: "application/octet-stream" };
    const download = vi.fn(async () => [Buffer.from(bytes)]), getMetadata = vi.fn(async () => [metadata]);
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: (name: string, options?: unknown) => { calls.push({ name, options }); return { getMetadata, download }; } }), requireOriginalEndpoint: () => {}, observer: journal.observer });
    const result = await store.readVersioned(key);
    expect(result?.revision.value).toBe(metadata.generation); expect(result?.body).toEqual(bytes);
    expect(calls).toEqual([{ name: key, options: undefined }, { name: key, options: { generation: metadata.generation } }]);
    expect(download).toHaveBeenCalledWith({ validation: false, decompress: false });
    expect(journal.requests.map(row => row.descriptor.kind)).toEqual(["object.metadata", "object.body"]);
    expect(journal.requests[1]?.facts.at(-1)).toMatchObject({ stage: "body", status: null, sha256: checksum, bytes: 6 });
  });
  it("retains Replit CREATE-only non-resumable upload ACK before later metadata failure", async () => {
    const journal = ledger(), file = { metadata: { name: "different-generation-key", bucket: replit.location.bucket, generation: "123", size: "6" }, save: vi.fn(async () => {}) };
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: () => file }), requireOriginalEndpoint: () => {}, observer: journal.observer });
    await expect(store.put(key, bytes, "application/octet-stream")).rejects.toThrow();
    expect(file.save).toHaveBeenCalledWith(Buffer.from(bytes), { resumable: false, validation: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "application/octet-stream" } });
    expect(journal.requests[0]?.returned).toBe(false); expect(journal.requests[0]?.facts).toEqual([expect.objectContaining({ stage: "accepted", status: null })]);
  });
  it("deletes only the actual original Replit generation while preserving a later current generation", async () => {
    const calls: unknown[] = [], removed = vi.fn(async () => {});
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: (name: string, options?: unknown) => { calls.push({ name, options }); return { delete: removed }; } }), requireOriginalEndpoint: () => {} });
    await store.deleteVersioned(key, { kind: "generation", key, namespace: replit.namespace, value: "9007199254740993" });
    expect(calls).toEqual([{ name: key, options: { generation: "9007199254740993" } }]);
    expect(removed).toHaveBeenCalledWith({ ifGenerationMatch: "9007199254740993" });
  });
  it("does not invent current absence when a pinned Replit generation read fails", async () => {
    const journal = ledger(), download = vi.fn(async () => { throw Object.assign(new Error("Original pinned generation not found"), { code: 404 }); });
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: () => ({ getMetadata: async () => [{ name: key, bucket: replit.location.bucket, generation: "123", size: "6" }], download }) }), requireOriginalEndpoint: () => {}, observer: journal.observer });
    await expect(store.readVersioned(key)).rejects.toThrow();
    expect(journal.requests[0]?.returned).toBe(true); expect(journal.requests[1]?.returned).toBe(false);
    expect(journal.requests[1]?.facts.some(fact => fact.stage === "absence")).toBe(false);
  });
  it("observes Replit retained generations and bucket soft-delete policy without adopting them", async () => {
    const requests: unknown[] = [], journal = ledger();
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ getFiles: async (options: unknown) => { requests.push(options); return [[{ name: key, metadata: { name: key, bucket: replit.location.bucket, generation: "123", size: "6" } }], { pageToken: "next-retained-page" }]; }, getMetadata: async () => [{ name: replit.location.bucket, versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: "604800" }, retentionPolicy: { retentionPeriod: "300" } }] }), requireOriginalEndpoint: () => {}, observer: journal.observer });
    const retained = await store.inventoryPage("retained"), configuration = await store.inventoryConfiguration();
    expect(retained).toMatchObject({ entries: [{ kind: "retained", key, bytes: 6 }], next: { token: "next-retained-page" } });
    expect(requests).toEqual([{ autoPaginate: false, maxResults: 250, softDeleted: true }]);
    expect(configuration).toEqual({ versioning: "Enabled", softDeleteSeconds: 604800, retentionSeconds: 300 });
    expect(journal.requests.map(row => row.descriptor.kind)).toEqual(["inventory.retained", "bucket.metadata"]);
  });
  it("addresses the exact original S3 version for an absence read instead of the current-key view",async()=>{
    const journal=ledger(),request=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(null,{status:404}));
    const original={kind:"etag"as const,key,namespace:s3.namespace,value:'"original-etag"',versionId:"original-version"};
    expect(await s3Store(request,journal.observer).readVersioned(key,original)).toBeUndefined();
    const[input,init]=request.mock.calls[0]!,url=new URL(input instanceof Request?input.url:input.toString());
    expect(url.searchParams.get("versionId")).toBe("original-version");expect(new Headers(init?.headers).get("if-match")).toBe(original.value);
    expect(journal.requests[0]?.descriptor.expectedRevision).toEqual(original);expect(journal.requests[0]?.facts.at(-1)).toMatchObject({stage:"absence",status:404});
  });

});
