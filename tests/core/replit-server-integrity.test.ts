// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual installed SDK upload path, memory transport only.
import type { Storage as GoogleStorage } from "@google-cloud/storage";
import { createRequire } from "node:module";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/core/http/respond";
import { createReplitStorage } from "@/adapters/storage/replit";
vi.mock("@/core/media/storage-quota", () => ({ storageNamespace: () => "synthetic-original-namespace" }));
const require = createRequire(import.meta.url);
const sdkPath = require.resolve("@google-cloud/storage").replace("/build/cjs/", "/build/esm/");
const { Storage } = await import(sdkPath) as { Storage: typeof GoogleStorage };
const bytes = Buffer.from("synthetic original upload bytes"), replacement = Buffer.from("synthetic concurrent owner bytes");
interface UploadDuplex { on(event: string, listener: () => void): void; setWritable(stream: Writable): void; emit(event: string): void }
function transport(mode: "matching" | "replacement" | "read-error" | "upload-error") {
  const state = { deletes: 0, uploads: 0, reads: 0, bytes: replacement, autoRetry: undefined as boolean | undefined };
  const original = Object.getOwnPropertyDescriptor(Storage.prototype, "bucket")!.value as GoogleStorage["bucket"];
  vi.spyOn(Storage.prototype, "bucket").mockImplementation(function (this: InstanceType<typeof Storage>, name, options) {
    state.autoRetry = this.retryOptions.autoRetry;
    const bucket = original.call(this, name, options), file = bucket.file("synthetic-target");
    const internal = file as unknown as { startResumableUpload_: (stream: UploadDuplex) => void };
    if (mode === "upload-error") Object.defineProperty(this.authClient, "request", { value: async () => { state.uploads++; throw Object.assign(new Error("synthetic lost upload reply"), { code: 503 }); } });
    else internal.startResumableUpload_ = duplex => {
      state.uploads++;
      duplex.on("error", () => {});
      duplex.setWritable(new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) {
        state.bytes = mode === "matching" ? bytes : replacement;
        file.metadata = { crc32c: "AAAAAA==", generation: "111" }; duplex.emit("metadata"); duplex.emit("complete"); done();
      } }));
    };
    Object.defineProperty(file, "delete", { value: async () => { state.deletes++; throw new Error("Autonomous deletion is forbidden"); } });
    Object.defineProperty(file, "download", { value: async () => { state.reads++; if (mode === "read-error") throw new Error("synthetic-private-provider-transport-detail"); return [state.bytes]; } });
    vi.spyOn(bucket, "file").mockReturnValue(file);
    return bucket;
  });
  return state;
}
const adapter = () => createReplitStorage({ bucketId: "synthetic-original-bucket", mediaPath: "/media" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Replit server integrity and positive observations (C1.12/C11.08)", () => {
  it("preserves a concurrent target on byte mismatch and observes the positive ACK first", async () => {
    const state = transport("replacement"), order: string[] = [];
    await expect(adapter().put("synthetic-target", bytes, "application/octet-stream", { onAccepted: async () => { expect(state.reads).toBe(0); order.push("accepted"); } })).rejects.toThrow(/full-byte/);
    expect(order).toEqual(["accepted"]); expect(state.deletes).toBe(0); expect(state.bytes).toEqual(replacement); expect(state.uploads).toBe(1); expect(state.autoRetry).toBe(false);
  });
  it("verifies every matching byte without SDK checksum cleanup", async () => {
    const state = transport("matching"), accepted = vi.fn(async () => {});
    expect(await adapter().put("synthetic-target", bytes, "application/octet-stream", { onAccepted: accepted })).toMatchObject({ bytes: bytes.length });
    expect(accepted).toHaveBeenCalledTimes(1); expect(state.deletes).toBe(0); expect(state.reads).toBe(1);
  });
  it("retains positive acknowledgment when readback fails without deleting anything", async () => {
    const state = transport("read-error"), accepted = vi.fn(async () => {});
    const error: unknown = await adapter().put("synthetic-target", bytes, "application/octet-stream", { onAccepted: accepted }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("storage: original Replit readback failed"); expect((error as Error).cause).toBeUndefined();
    const log = vi.spyOn(console, "error").mockImplementation(() => {}), response = errorResponse(error, { kind: "anonymous" });
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: { code: "internal", message: "Something went wrong." } });
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("synthetic-private-provider-transport-detail");
    expect(accepted).toHaveBeenCalledTimes(1); expect(state.deletes).toBe(0); expect(state.uploads).toBe(1);
  });
  it("does not replay or delete after an uncertain upload and invents no positive ACK", async () => {
    const state = transport("upload-error"), accepted = vi.fn(async () => {});
    await expect(adapter().put("synthetic-target", bytes, "application/octet-stream", { onAccepted: accepted })).rejects.toThrow(/not acknowledged/);
    expect(accepted).not.toHaveBeenCalled(); expect(state.deletes).toBe(0); expect(state.uploads).toBe(1); expect(state.reads).toBe(0);
  });
  it("stops before readback when persisting positive evidence fails", async () => {
    const state = transport("matching");
    await expect(adapter().put("synthetic-target", bytes, "application/octet-stream", { onAccepted: async () => { throw new Error("synthetic persistence failure"); } })).rejects.toThrow(/persistence/);
    expect(state.deletes).toBe(0); expect(state.reads).toBe(0); expect(state.uploads).toBe(1);
  });
  it("refuses an emulator before binding, bucket discovery, or provider initialization", async () => {
    vi.stubEnv("STORAGE_EMULATOR_HOST", "https://synthetic-emulator.example.test");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const bucket = vi.spyOn(Storage.prototype, "bucket");
    const store = createReplitStorage({ mediaPath: "/media" });
    await expect(store.binding!()).rejects.toThrow(/EMULATOR/); await expect(store.get("synthetic-target")).rejects.toThrow(/EMULATOR/); await expect(store.delete("synthetic-target")).rejects.toThrow(/EMULATOR/); await expect(store.put("synthetic-target", bytes, "text/plain")).rejects.toThrow(/EMULATOR/);
    expect(fetcher).not.toHaveBeenCalled(); expect(bucket).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("checks emulator routing again when an initialized writer and binding are reused", async () => {
    const state = transport("matching"), store = adapter();
    await store.put("synthetic-target", bytes, "text/plain"); await store.binding!();
    vi.stubEnv("STORAGE_EMULATOR_HOST", "");
    await expect(store.put("synthetic-target", bytes, "text/plain")).rejects.toThrow(/EMULATOR/); await expect(store.binding!()).rejects.toThrow(/EMULATOR/);
    expect(state.uploads).toBe(1); expect(state.deletes).toBe(0);
  });
});
