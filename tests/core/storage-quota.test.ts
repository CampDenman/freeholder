// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, closeDb } from "@/core/db";
import { withStorageQuota as withStorageQuotaAdapter, type StorageQuotaLedger } from "@/adapters/storage/quota";
import { createS3Storage } from "@/adapters/storage/s3";
import type { StorageAdapter } from "@/adapters/storage/types";
import { initializeStorageQuota, postgresStorageQuota as postgresQuotaLedger, storageInventorySha256, storageNamespace, withVerifiedEmptyInitialization as emptyQuotaLedger } from "@/core/media/storage-quota";
import { observeTransferRequest } from "@/core/media/transfer-requests";
import { ordinaryMediaRequestProvider } from "../helpers/media-original-provider-requests";
import { quotaStorageLocation, registerQuotaStorage, withQuotaCaller } from "../helpers/storage-quota-scope";

const syntheticOrigin = "https://s3.us-east-1.amazonaws.com";
const realFetch = globalThis.fetch.bind(globalThis);
let tcpProvider: Awaited<ReturnType<typeof ordinaryMediaRequestProvider>>;
const ledgerNamespaces = new WeakMap<StorageQuotaLedger, string>();
const physicalKey = (namespace: string, key: string) => `${namespace.slice(0, 16)}/${key}`;
function mappedLedger(ledger: StorageQuotaLedger, namespace: string): StorageQuotaLedger {
  const mapped = {
    reserve: (key: string, bytes: number, token: string) => ledger.reserve(physicalKey(namespace, key), bytes, token),
    settle: (key: string, bytes: number, token: string) => ledger.settle(physicalKey(namespace, key), bytes, token),
  };
  ledgerNamespaces.set(mapped, namespace);
  return mapped;
}
function postgresStorageQuota(namespace: string, maxBytes: number) {
  return mappedLedger(postgresQuotaLedger(namespace, maxBytes), namespace);
}
function withVerifiedEmptyInitialization(namespace: string, maxBytes: number, verify: () => Promise<void>) {
  return mappedLedger(emptyQuotaLedger(namespace, maxBytes, verify), namespace);
}
function withStorageQuota(inner: StorageAdapter, ledger: StorageQuotaLedger): StorageAdapter {
  const namespace = ledgerNamespaces.get(ledger);
  if (!namespace) throw new Error("The quota test needs its original namespace.");
  const wrapped = withStorageQuotaAdapter({
    ...inner,
    put: async (key, body, contentType, observation) => ({ ...await inner.put(physicalKey(namespace, key), body, contentType, observation), key }),
    delete: key => inner.delete(physicalKey(namespace, key)),
  }, ledger);
  return {
    ...wrapped,
    put: (key, body, contentType, observation) => withQuotaCaller({ namespace, key: physicalKey(namespace, key), bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") }, () => wrapped.put(key, body, contentType, { ...observation, request: observeTransferRequest })),
    delete: key => withQuotaCaller({ namespace, key: physicalKey(namespace, key), bytes: 0 }, async () => {
      await inner.put(physicalKey(namespace, key), bytes(0), "text/plain", { request: observeTransferRequest });
      return wrapped.delete(key);
    }),
  };
}

function ns() {
  const location = { endpoint: syntheticOrigin, bucket: `quota-${randomBytes(16).toString("hex")}` };
  const namespace = storageNamespace({ id: "s3", ...location });
  registerQuotaStorage(namespace, location);
  return namespace;
}
async function initialized(limit = 10, inventory: { key: string; bytes: number }[] = []) {
  const namespace = ns();
  const physicalInventory = inventory.map(object => ({ ...object, key: physicalKey(namespace, object.key) }));
  await initializeStorageQuota(namespace, limit, physicalInventory, storageInventorySha256(physicalInventory));
  return { namespace, ledger: postgresStorageQuota(namespace, limit) };
}
function provider(namespace?: string) {
  const location = namespace ? quotaStorageLocation(namespace) : { endpoint: syntheticOrigin, bucket: "quota-uninitialized" };
  const raw = createS3Storage({ ...location, region: "us-east-1", accessKeyId: "synthetic", secretAccessKey: "synthetic" });
  const unavailable=vi.fn(async()=>{throw Error("unwrapped direct upload must never run");});
  return { ...raw,
    put: vi.fn((...args: Parameters<StorageAdapter["put"]>) => raw.put(...args)),
    get: vi.fn((...args: Parameters<StorageAdapter["get"]>) => raw.get(...args)),
    head: vi.fn((...args: Parameters<StorageAdapter["head"]>) => raw.head(...args)),
    readRange: vi.fn((...args: Parameters<StorageAdapter["readRange"]>) => raw.readRange(...args)),
    stream: vi.fn((...args: Parameters<StorageAdapter["stream"]>) => raw.stream(...args)),
    url: vi.fn((...args: Parameters<StorageAdapter["url"]>) => raw.url(...args)),
    delete: vi.fn((...args: Parameters<StorageAdapter["delete"]>) => raw.delete(...args)),
    directMultipart: { create: unavailable, signPart: unavailable, listParts: unavailable, complete: unavailable, abort: unavailable },
  } satisfies StorageAdapter;
}
const bytes = (n: number) => new Uint8Array(n);
const code = (value: Promise<unknown>, expected: string) => expect(value).rejects.toMatchObject({ code: expected });

describe.skipIf(!process.env.TEST_DATABASE_URL)("C10.32 real Postgres quota reservations", () => {
  // The repository's normal global setup applies the complete native journal.
  // Cases use distinct namespaces and never truncate existing business data.
  beforeAll(async () => {
    tcpProvider = await ordinaryMediaRequestProvider();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== syntheticOrigin) return realFetch(input, init);
      const target = new URL(`${url.pathname}${url.search}`, tcpProvider.endpoint);
      if (input instanceof Request) return realFetch(target, { method: input.method, headers: input.headers, body: input.body === null ? undefined : await input.arrayBuffer() });
      return realFetch(target, init);
    });
  });
  afterAll(async () => {
    await tcpProvider?.close();
    vi.unstubAllGlobals();
    await closeDb();
  });

  it("refuses provider writes without inventory and refuses a different configured limit", async () => {
    const raw = provider();
    await code(withStorageQuota(raw, postgresStorageQuota(ns(), 10)).put("x", bytes(1), "text/plain"), "storage_quota_inventory_required");
    const { namespace } = await initialized();
    await code(withStorageQuota(raw, postgresStorageQuota(namespace, 11)).put("x", bytes(1), "text/plain"), "storage_quota_inventory_required");
    expect(raw.put).not.toHaveBeenCalled();
  });
  it("serializes competing processes before I/O and accounts derived objects too", async () => {
    const { namespace } = await initialized();
    const raw = provider(namespace);
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => withStorageQuota(raw, postgresStorageQuota(namespace, 10)).put(`derived-${i}`, bytes(6), "text/plain")));
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(raw.put).toHaveBeenCalledTimes(1);
    const held = await db().execute<{ used: string }>(sql`select sum(bytes)::text as used from storage_quota_objects where namespace=${namespace}`);
    expect(held[0]!.used).toBe("6");
  });
  it("retains maximum old/new bytes until overwrite success, then frees shrink space", async () => {
    const { namespace, ledger } = await initialized(10, [{ key: "old", bytes: 10 }]);
    let release!: () => void;
    const raw = provider(namespace), actualPut = raw.put;
    raw.put = vi.fn(async (key:string, body:Uint8Array<ArrayBuffer>, contentType:string, observation?:Parameters<StorageAdapter["put"]>[3]) => { await new Promise<void>(r => { release = r; }); return actualPut(key, body, contentType, observation); });
    const store = withStorageQuota(raw, ledger), pending = store.put("old", bytes(2), "text/plain");
    await vi.waitFor(() => expect(raw.put).toHaveBeenCalledTimes(1));
    await code(store.put("other", bytes(8), "text/plain"), "storage_quota_exceeded");
    await code(store.put("old", bytes(2), "text/plain"), "storage_quota_object_unresolved");
    release(); await pending;
    await expect(withStorageQuota(provider(namespace), ledger).put("other", bytes(8), "text/plain")).resolves.toMatchObject({ bytes: 8 });
  });
  it("commits the pending reservation before provider I/O and preserves an ambiguous write across restart", async () => {
    const { namespace, ledger } = await initialized();
    const raw = provider(namespace);
    raw.put = vi.fn(async () => {
      const held = await db().execute<{ bytes: string; pending_token: string }>(sql`select bytes::text,pending_token from storage_quota_objects where namespace=${namespace} and object_key=${physicalKey(namespace, "uncertain")}`);
      expect(held[0]!.bytes).toBe("8"); expect(held[0]!.pending_token).toBeTruthy();
      throw new Error("provider connection lost after accepting bytes");
    });
    await expect(withStorageQuota(raw, ledger).put("uncertain", bytes(8), "text/plain")).rejects.toThrow("provider connection lost");
    const restarted = withStorageQuota(provider(namespace), postgresStorageQuota(namespace, 10));
    await code(restarted.put("uncertain", bytes(8), "text/plain"), "storage_quota_object_unresolved");
    await code(restarted.put("next", bytes(3), "text/plain"), "storage_quota_exceeded");
  });
  it("does not free deleted bytes before provider confirmation or after an ambiguous delete", async () => {
    const { namespace, ledger } = await initialized(10, [{ key: "old", bytes: 10 }]);
    const raw = provider(namespace); raw.delete = vi.fn(async () => { throw new Error("unknown delete"); });
    await expect(withStorageQuota(raw, ledger).delete("old")).rejects.toThrow("unknown delete");
    await code(withStorageQuota(raw, ledger).put("next", bytes(1), "text/plain"), "storage_quota_exceeded");
    const second = await initialized(10, [{ key: "old", bytes: 10 }]);
    const store = withStorageQuota(provider(second.namespace), second.ledger);
    await store.delete("old"); await expect(store.put("new", bytes(10), "text/plain")).resolves.toMatchObject({ bytes: 10 });
  });
  it("never settles another token/key/namespace or a provider size mismatch", async () => {
    const { namespace, ledger } = await initialized(), token = randomUUID();
    await withQuotaCaller({ namespace, key: physicalKey(namespace, "first"), bytes: 8 }, () => ledger.reserve("first", 8, token));
    await code(ledger.settle("first", 0, randomUUID()), "storage_quota_operation_changed");
    await code(ledger.settle("other", 0, token), "storage_quota_operation_changed");
    const other = await initialized();
    await code(other.ledger.settle("first", 0, token), "storage_quota_operation_changed");
    const fresh = await initialized();
    const raw = provider(fresh.namespace), actualPut = raw.put;
    raw.put = vi.fn(async (key:string, body:Uint8Array<ArrayBuffer>, contentType:string, observation?:Parameters<StorageAdapter["put"]>[3]) => { await actualPut(key, body, contentType, observation); return { key, bytes: 0, contentType: "text/plain" }; });
    await code(withStorageQuota(raw, fresh.ledger).put("mismatch", bytes(8), "text/plain"), "storage_quota_provider_result_mismatch");
    await code(withStorageQuota(provider(fresh.namespace), fresh.ledger).put("next", bytes(3), "text/plain"), "storage_quota_exceeded");
  });
  it("refuses duplicate/incomplete digest/over-limit baseline and will not replace initialized state", async () => {
    const inventory = [{ key: "known", bytes: 6 }], namespace = ns();
    await code(initializeStorageQuota(namespace, 10, inventory, "0".repeat(64)), "storage_quota_inventory_required");
    const duplicate = [...inventory, ...inventory];
    await code(initializeStorageQuota(namespace, 20, duplicate, storageInventorySha256(duplicate)), "storage_quota_invalid_inventory");
    await code(initializeStorageQuota(namespace, 5, inventory, storageInventorySha256(inventory)), "storage_quota_exceeded");
    await initializeStorageQuota(namespace, 10, inventory, storageInventorySha256(inventory));
    await expect(initializeStorageQuota(namespace, 10, [], storageInventorySha256([]))).rejects.toThrow();
    await code(withStorageQuota(provider(namespace), postgresStorageQuota(namespace, 10)).put("new", bytes(5), "text/plain"), "storage_quota_exceeded");
  });
  it("preserves signed private reads and omits unenforceable direct-upload capability", async () => {
    const { namespace, ledger } = await initialized(), raw = provider(namespace), store = withStorageQuota(raw, ledger);
    expect(store.isPublic).toBe(false); expect(store.directMultipart).toBeUndefined();
    await store.get("private"); await store.head("private"); await store.stream("private"); await store.readRange("private", 1, 4);
    await store.url("private", { expiresIn: 7, downloadAs: "owned.txt" });
    expect(raw.url).toHaveBeenCalledWith("private", { expiresIn: 7, downloadAs: "owned.txt" });
    expect(raw.readRange).toHaveBeenCalledWith("private", 1, 4);
  });
  it("initializes only after verified empty inventory and never resets it in a concurrent process",async()=>{
    const namespace=ns(), verify=vi.fn(async()=>{}), raw=provider(namespace);
    const stores=Array.from({length:4},()=>withStorageQuota(raw,withVerifiedEmptyInitialization(namespace,10,verify)));
    const results=await Promise.allSettled(stores.map((store,i)=>store.put("variant-"+i,bytes(6),"text/plain")));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(raw.put).toHaveBeenCalledTimes(1);
    const restarted=withStorageQuota(raw,withVerifiedEmptyInitialization(namespace,10,async()=>{throw Error("must not list/reset initialized namespace");}));
    await expect(restarted.put("remaining",bytes(4),"text/plain")).resolves.toMatchObject({bytes:4});
    await code(restarted.put("over",bytes(1),"text/plain"),"storage_quota_exceeded");
  });
  it("does not initialize or call the provider when fresh inventory cannot be established",async()=>{
    const namespace=ns(), raw=provider(namespace), verify=vi.fn(async()=>{throw Error("nonempty or unknown inventory");});
    await expect(withStorageQuota(raw,withVerifiedEmptyInitialization(namespace,10,verify)).put("x",bytes(1),"text/plain")).rejects.toThrow("unknown inventory");
    expect(raw.put).not.toHaveBeenCalled();
    expect(await db().execute(sql`select namespace from storage_quota_state where namespace=${namespace}`)).toHaveLength(0);
  });
  it("binds bytes before asynchronous admission even if the caller resizes and reuses its buffer",async()=>{
    const {namespace,ledger}=await initialized(),buffer=new ArrayBuffer(2,{maxByteLength:20}),body=new Uint8Array(buffer);body.set([1,2]);
    const raw=provider(namespace),actualPut=raw.put;raw.put=vi.fn(async(key:string,payload:Uint8Array<ArrayBuffer>,contentType:string,observation?:Parameters<StorageAdapter["put"]>[3])=>{expect([...payload]).toEqual([1,2]);return actualPut(key,payload,contentType,observation);});
    const wrapped={settle:ledger.settle.bind(ledger),reserve:async(key:string,n:number,token:string)=>{await ledger.reserve(key,n,token);buffer.resize(20);body.fill(9);}};
    ledgerNamespaces.set(wrapped,namespace);
    await expect(withStorageQuota(raw,wrapped).put("source-bound",body,"text/plain")).resolves.toMatchObject({bytes:2});
  });
});
