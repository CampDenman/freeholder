// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: provider-shaped local controls, not account acceptance.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createS3TransferProtocol, createReplitTransferProtocol, proveS3ConditionalSemantics, requireS3ConditionalAuthority } from "../../scripts/media-transfer-protocol.mjs";
import { checkedTransferBinding } from "@/core/media/transfer-witness";
import { storageNamespace } from "@/core/media/storage-quota";
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
function s3Store(request: typeof fetch, observer?: TransferRequestObserver, origin = "https://s3.us-east-1.amazonaws.com/original-media") {
  return createS3TransferProtocol({ client: { fetch: request }, binding: s3, url: value => `${origin}/${value.split("/").map(encodeURIComponent).join("/")}`, observer });
}
const list = (kind: "objects" | "versions" | "sessions", body: string, more = "false") => `<${kind === "objects" ? "ListBucketResult" : kind === "versions" ? "ListVersionsResult" : "ListMultipartUploadsResult"}><${kind === "objects" ? "Name" : "Bucket"}>original-media</${kind === "objects" ? "Name" : "Bucket"}><EncodingType>url</EncodingType><IsTruncated>${more}</IsTruncated>${kind === "objects" ? "<KeyCount>1</KeyCount>" : ""}${body}</${kind === "objects" ? "ListBucketResult" : kind === "versions" ? "ListVersionsResult" : "ListMultipartUploadsResult"}>`;

describe("C1.12/C11.08 actual provider protocol boundaries", () => {
  it("retains actual S3 metadata and complete exact binary-body SHA in one physical request", async () => {
    const journal = ledger(), request = vi.fn(async () => new Response(bytes, { headers: { etag: '"original-etag"', "x-amz-version-id": "original-version", "content-type": "application/octet-stream", "content-length": String(bytes.byteLength) } }));
    const result = await s3Store(request, journal.observer).readVersioned(key);
    expect(result?.body).toEqual(bytes); expect(result?.revision.versionId).toBe("original-version");
    expect(journal.requests).toHaveLength(1); expect(journal.requests[0]?.returned).toBe(true);
    expect(journal.requests[0]?.facts.at(-1)).toMatchObject({ stage: "body", sha256: checksum, bytes: bytes.byteLength, status: 200 });
  });
  it("bounds an S3 body at the expected bytes plus one without calling arrayBuffer", async () => {
    let pulls = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(bytes.byteLength + 1)); }, cancel() { cancelled = true; } });
    const arrayBuffer = vi.fn(), response = { status: 200, ok: true, headers: new Headers({ etag: '"original-etag"', "content-length": String(bytes.byteLength) }), body: stream, arrayBuffer } as unknown as Response;
    await expect(s3Store(vi.fn(async () => response)).readVersioned(key, undefined, bytes.byteLength)).rejects.toThrow();
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(pulls).toBeLessThanOrEqual(2); expect(cancelled).toBe(true);
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
  it.each(["put", "delete"] as const)("fails closed before an unversioned S3-compatible %s when conditional authority is unknown", async operation => {
    let current: Uint8Array | undefined = new TextEncoder().encode("newer generation");
    const request = vi.fn(async () => { current = undefined; return new Response(null, { status: 200 }); });
    const store = s3Store(request, undefined, "https://storage.example.test/original-media");
    const revision = { kind: "etag" as const, key, namespace: s3.namespace, value: '"original-etag"' };
    await expect(operation === "put" ? store.put(key, bytes, "application/octet-stream") : store.deleteVersioned(key, revision)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled(); expect(current).toEqual(new TextEncoder().encode("newer generation"));
  });
  it("uses an exact S3 version as deletion authority even when a compatible provider ignores If-Match", async () => {
    const current: Uint8Array | undefined = new TextEncoder().encode("newer generation"); let retired: string | undefined;
    const request = vi.fn(async (input: RequestInfo | URL) => { const target = new URL(input instanceof Request ? input.url : input.toString()); retired = target.searchParams.get("versionId") ?? undefined; return new Response(null, { status: 204 }); });
    await s3Store(request, undefined, "https://storage.example.test/original-media").deleteVersioned(key, { kind: "etag", key, namespace: s3.namespace, value: '"original-etag"', versionId: "original-version" });
    expect(retired).toBe("original-version"); expect(current).toEqual(new TextEncoder().encode("newer generation")); expect(request).toHaveBeenCalledTimes(1);
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
    const createReadStream = vi.fn(() => Readable.from([Buffer.from(bytes)], { objectMode: false })), download = vi.fn(), getMetadata = vi.fn(async () => [metadata]);
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: (name: string, options?: unknown) => { calls.push({ name, options }); return { getMetadata, createReadStream, download }; } }), requireOriginalEndpoint: () => {}, observer: journal.observer });
    const result = await store.readVersioned(key);
    expect(result?.revision.value).toBe(metadata.generation); expect(result?.body).toEqual(bytes);
    expect(calls).toEqual([{ name: key, options: undefined }, { name: key, options: { generation: metadata.generation } }]);
    expect(createReadStream).toHaveBeenCalledWith({ validation: false, decompress: false, start: 0, end: 6 }); expect(download).not.toHaveBeenCalled();
    expect(journal.requests.map(row => row.descriptor.kind)).toEqual(["object.metadata", "object.body"]);
    expect(journal.requests[1]?.facts.at(-1)).toMatchObject({ stage: "body", status: null, sha256: checksum, bytes: 6 });
  });
  it("stops and rejects an oversized Replit generation without buffering it through download", async () => {
    const stream = Readable.from([Buffer.alloc(bytes.byteLength + 1)], { objectMode: false }), download = vi.fn();
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: () => ({ getMetadata: async () => [{ name: key, bucket: replit.location.bucket, generation: "123", size: String(bytes.byteLength) }], createReadStream: () => stream, download }) }), requireOriginalEndpoint: () => {} });
    await expect(store.readVersioned(key, undefined, bytes.byteLength)).rejects.toThrow();
    expect(stream.destroyed).toBe(true); expect(download).not.toHaveBeenCalled();
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
    const journal = ledger(), createReadStream = vi.fn(() => new Readable({ read() { this.destroy(Object.assign(new Error("Original pinned generation not found"), { code: 404 })); } }));
    const store = createReplitTransferProtocol({ binding: replit, destination: async () => ({ file: () => ({ getMetadata: async () => [{ name: key, bucket: replit.location.bucket, generation: "123", size: "6" }], createReadStream }) }), requireOriginalEndpoint: () => {}, observer: journal.observer });
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

describe("non-AWS conditional authority (C1.12/C11.08)", () => {
  const url = (value: string) => `http://127.0.0.1:9000/original-media/${value.split("/").map(encodeURIComponent).join("/")}`;
  const awsUrl = (value: string) => `https://s3.us-east-1.amazonaws.com/original-media/${value.split("/").map(encodeURIComponent).join("/")}`;
  const bucket = { endpoint: "http://127.0.0.1:9000", bucket: "original-media" };
  const aws = { endpoint: "https://s3.us-east-1.amazonaws.com", bucket: "original-media" };
  // Authority travels BESIDE the binding. It must never be added to
  // `location`: transfer-witness.ts parses that strictly, so an extra field
  // there refuses every recorded write with "without credentials or extra
  // fields" -- which is how the recipe gate caught exactly that mistake.
  const authority = (facts: Record<string, string>, location = bucket, target = url, versionId?: string) =>
    requireS3ConditionalAuthority({ kind: "s3", namespace: "a".repeat(64), location }, target, "private/original.bin", versionId, facts);
  const refusal = (run: () => void) => {
    try { run(); } catch (error) { return (error as { reason?: string }).reason; }
    throw new Error("The authority check must refuse.");
  };

  it("trusts AWS alone, and any other endpoint only once versioning and the probe both hold", () => {
    expect(() => authority({}, aws, awsUrl)).not.toThrow();
    // An unversioned non-AWS bucket is named for the fact an operator can
    // change, not for the probe that could not have rescued it.
    expect(refusal(() => authority({}))).toBe("conditional_unversioned");
    expect(refusal(() => authority({ versioning: "enabled" }))).toBe("conditional_unproven");
    expect(refusal(() => authority({ conditional: "proven" }))).toBe("conditional_unversioned");
    expect(() => authority({ versioning: "enabled", conditional: "proven" })).not.toThrow();
    // A supplied version id addresses one immutable version, so it never
    // needed the preconditions in the first place.
    expect(() => authority({}, bucket, url, "version-1")).not.toThrow();
  });

  it("proves the two preconditions, and refuses a provider that accepts either while ignoring it", async () => {
    const store = (behaviour: (method: string, headers: Record<string, string>) => Response) => ({
      fetch: (async (_target: unknown, init: { method?: string; headers?: Record<string, string> } = {}) =>
        behaviour(init.method ?? "GET", init.headers ?? {})) as unknown as typeof fetch,
    });
    const honest = () => { let present = false; return store((method, headers) => {
      if (method === "PUT") { if (present && headers["if-none-match"] === "*") return new Response(null, { status: 412 }); present = true; return new Response(null, { status: 200, headers: { etag: '"probe"' } }); }
      if (method === "DELETE") { if (headers["if-match"] !== '"probe"') return new Response(null, { status: 412 }); present = false; return new Response(null, { status: 204 }); }
      return new Response(null, { status: 404 }); }); };
    await expect(proveS3ConditionalSemantics({ client: honest(), url })).resolves.toEqual({ conditional: "proven" });

    const ignoresCreateOnly = store(method => method === "PUT"
      ? new Response(null, { status: 200, headers: { etag: '"probe"' } })
      : new Response(null, { status: 412 }));
    await expect(proveS3ConditionalSemantics({ client: ignoresCreateOnly, url })).rejects.toMatchObject({ reason: "conditional_probe_create_only" });

    const ignoresIfMatch = (() => { let present = false; return store(method => {
      if (method === "PUT") { if (present) return new Response(null, { status: 412 }); present = true; return new Response(null, { status: 200, headers: { etag: '"probe"' } }); }
      return new Response(null, { status: 204 }); }); })();
    await expect(proveS3ConditionalSemantics({ client: ignoresIfMatch, url })).rejects.toMatchObject({ reason: "conditional_probe_if_match" });
  });
});

describe("the binding stays a minimal evidence projection (C1.12/C11.08)", () => {
  // The first version of the conditional-authority work carried its two facts
  // inside `binding.location`. Every unit suite passed, and the recipe gate
  // then refused every recorded write with "Choose an explicit S3 or Replit
  // storage resource without credentials or extra fields", because
  // transferBindingSchema parses `location` .strict() so that nothing can ride
  // along into recorded evidence -- and because the namespace digest is
  // derived from endpoint and bucket alone. This asserts the rule directly,
  // since no other local test covered the path that caught it.
  const endpoint = "https://s3.us-east-1.amazonaws.com", bucket = "original-media";
  const binding = { kind: "s3" as const, namespace: storageNamespace({ id: "s3", endpoint, bucket }), location: { endpoint, bucket } };

  it("accepts the binding the S3 adapter builds", () => {
    expect(checkedTransferBinding(binding)).toMatchObject({ kind: "s3", location: { endpoint, bucket } });
  });

  it("refuses a binding whose location carries the conditional-authority facts", () => {
    for (const extra of [{ versioning: "enabled" }, { conditional: "proven" }, { versioning: "enabled", conditional: "proven" }]) {
      expect(() => checkedTransferBinding({ ...binding, location: { ...binding.location, ...extra } }))
        .toThrow(/without credentials or extra fields/);
    }
  });
});

describe("a refused listing says which listing and why (C1.12/C11.08)", () => {
  // `list_root` used to cover both "the provider answered with another root
  // element, or an error document" and "the provider answered about another
  // bucket". Those have different fixes, and the recipe gate reported only the
  // shared token, so the cause had to be guessed at.
  const bucket = "original-media";
  const answering = (body: string) => createS3TransferProtocol({
    client: { fetch: async () => new Response(body, { status: 200, headers: { "content-type": "application/xml" } }) },
    binding: { kind: "s3", namespace: "a".repeat(64), location: { endpoint: "http://127.0.0.1:9000", bucket } },
    url: (value: string) => `http://127.0.0.1:9000/${bucket}/${value}`,
  });
  const reason = async (body: string, kind: "objects" | "versions" | "sessions") => {
    try { await answering(body).inventoryPage(kind); } catch (error) { return (error as { reason?: string }).reason; }
    throw new Error("The listing must be refused.");
  };

  it("names a listing that answered about another bucket", async () => {
    await expect(reason(list("objects", "", "false").replace(bucket, "somebody-else"), "objects")).resolves.toBe("list_root_bucket");
  });

  it("names the root element a provider never sent", async () => {
    // A store without ListObjectVersions or ListMultipartUploads answers an
    // error document, which is a missing root rather than a wrong bucket.
    await expect(reason("<Error><Code>NotImplemented</Code></Error>", "versions")).resolves.toBe("list_root_absent:ListVersionsResult");
    await expect(reason("<Error><Code>NotImplemented</Code></Error>", "sessions")).resolves.toBe("list_root_absent:ListMultipartUploadsResult");
  });
});
