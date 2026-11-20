// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Filesystem storage. The development default, and (C3.44) a supported
// production mode for a single-server install that keeps its media directory
// across updates and backs it up: the native Linux installer's
// /var/lib/freeholder/media, or the Docker recipe's named volume. What §18
// still refuses is the implicit relative directory, which lives inside the
// release or the container layer and is thrown away by a rebuild.
//
// One app process only: two processes on two machines cannot share it. Move
// to S3-compatible storage before scaling out (deploy/linux/README.md).
import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type {
  AccountedTransferStore,
  TransferInventoryEntry,
  TransferRequestObservation,
  TransferRequestObserver,
  TransferRevision,
} from "../../../scripts/media-transfer.mjs";
import type { StorageAdapter, StorageBinding, StoredObject, StoredObjectRevision } from "@/adapters/storage/types";
import { env } from "@/core/env";
import { localStorageMode } from "@/adapters/storage/local-mode";
import { storageNamespace } from "@/core/media/storage-quota";

export interface LocalConfig {
  /** Directory to write under. Created on demand. */
  root: string;
  /** Path the files are served from, for building URLs. */
  publicPath: string;
}

/**
 * §18's storage mandate, enforced rather than documented: media is the least
 * recoverable asset a business has. A production instance may keep it on
 * local disk only in a directory it names explicitly (an absolute
 * LOCAL_STORAGE_ROOT), which the self-host recipes keep across updates and
 * include in the nightly backup. That directory must already exist: creating
 * it on demand would quietly write to the container layer when a volume was
 * forgotten.
 *
 * The legacy override remains for an implicit directory, and it is still
 * named to be embarrassing in a config review.
 */
function refuseInProduction(root: string): void {
  // Through env() like everything else: a guard that decides for itself what
  // production means can disagree with the platform that configured it, and
  // the disagreement is only discovered by losing an owner's media.
  const current = env();
  const mode = localStorageMode(current);
  if (mode === "development") return;
  if (mode === "persistent") {
    let directory = false;
    try {
      directory = statSync(/* turbopackIgnore: true */ root).isDirectory();
      accessSync(/* turbopackIgnore: true */ root, constants.W_OK);
    } catch {
      directory = false;
    }
    if (!directory) {
      throw new Error(
        `LOCAL_STORAGE_ROOT (${root}) must be an existing directory this ` +
          "process can write. Create it on persistent disk (the self-host " +
          "installers do), or mount the recipe's media volume there.",
      );
    }
    return;
  }
  if (mode === "unsafe") {
    console.warn(
      "[storage] Using local disk in production because " +
        "FREEHOLDER_UNSAFE_LOCAL_STORAGE=1. Uploaded media will be lost if " +
        "this machine is rebuilt, and cannot be served by a second instance.",
    );
    return;
  }
  throw new Error(
    "Storage is set to \"local\" without a persistent directory. In " +
      "production, local disk is for development only unless it is a " +
      "directory you keep and back up (MASTER.md §18).\n" +
      "Set LOCAL_STORAGE_ROOT to an absolute path on persistent disk (the " +
      "self-host installers use /var/lib/freeholder/media), or set " +
      "adapters.storage to \"s3\" in freeholder.config.ts and configure S3_* " +
      "in the environment: DigitalOcean Spaces, Cloudflare R2, MinIO and AWS " +
      "all work.\n" +
      "To keep media in an implicit directory anyway, set " +
      "FREEHOLDER_UNSAFE_LOCAL_STORAGE=1.",
  );
}

const REQUEST_DIRECTORY = ".freeholder-original-requests";
const MAX_PAGE = 250;
const digest = (value: unknown): string => createHash("sha256")
  .update(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value))
  .digest("hex");
const tokenDigest = (token: string): string => createHash("sha256")
  .update("freeholder:verified-storage-transfer:v1\0")
  .update(JSON.stringify(token))
  .digest("hex");

function localPath(root: string, key: string): string {
  // Both components are runtime values. Without the trace annotation,
  // Turbopack treats local media reads as permission to package the whole
  // repository into the production standalone output.
  const target = resolve(join(/* turbopackIgnore: true */ root, key)), requests = join(root, REQUEST_DIRECTORY);
  if ((target !== root && !target.startsWith(root + sep)) || target === requests || target.startsWith(requests + sep)) {
    throw new Error(`storage: key escapes the storage root: ${key}`);
  }
  return target;
}

function localRevision(binding: StorageBinding, key: string, sha256: string): StoredObjectRevision {
  if (binding.kind !== "local" || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("storage: invalid local object revision");
  return { kind: "generation", key, namespace: binding.namespace, value: sha256 };
}

function pinnedLocalRevision(input: TransferRevision, binding: StorageBinding, key: string): TransferRevision {
  if (input.kind !== "generation" || input.key !== key || input.namespace !== binding.namespace || !/^[a-f0-9]{64}$/.test(input.value) || input.versionId !== undefined) {
    throw new Error("storage: the pinned local revision does not identify the exact original bytes");
  }
  return input;
}

function sameLocalRevision(actual: TransferRevision, pinned: TransferRevision): boolean {
  return actual.kind === pinned.kind && actual.key === pinned.key && actual.namespace === pinned.namespace && actual.value === pinned.value && actual.versionId === pinned.versionId;
}

function localRequestPath(root: string, key: string): string {
  return join(root, REQUEST_DIRECTORY, `${digest(`freeholder:local-request-key:v1\0${key}`)}.json`);
}

interface LocalRequestRecord {
  key: string;
  namespace: string;
  sha256: string;
  contentType: string;
  requestId: string;
  tokenDigest: string;
}

export function createLocalRequestStore(config: LocalConfig, observer: TransferRequestObserver): AccountedTransferStore {
  const root = resolve(config.root);
  refuseInProduction(root);
  const binding: StorageBinding = Object.freeze({
    kind: "local",
    namespace: storageNamespace({ id: "local", root }),
    location: Object.freeze({ root }),
  });
  const requestPath = (key: string) => localRequestPath(root, key);

  async function requestRecord(key: string): Promise<LocalRequestRecord | undefined> {
    let source: string;
    try { source = await readFile(requestPath(key), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("storage: invalid original local request record");
    const record = value as Record<string, unknown>;
    if (record.key !== key || record.namespace !== binding.namespace || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)
      || typeof record.contentType !== "string" || !record.contentType || record.contentType.length > 255
      || typeof record.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.requestId)
      || typeof record.tokenDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenDigest)
      || Object.keys(record).sort().join(",") !== "contentType,key,namespace,requestId,sha256,tokenDigest") {
      throw new Error("storage: original local request record does not match its namespace and key");
    }
    return { key, namespace: binding.namespace, sha256: record.sha256, contentType: record.contentType, requestId: record.requestId, tokenDigest: record.tokenDigest };
  }

  async function actualObject(key: string, maxBytes?: number) {
    const target = localPath(root, key);
    let body: Uint8Array<ArrayBuffer>;
    try {
      if (maxBytes !== undefined) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("storage: invalid local read bound");
        const facts = await stat(/* turbopackIgnore: true */ target);
        if (!facts.isFile() || facts.size > maxBytes) throw new Error("storage: original local object exceeds its exact read bound");
      }
      body = new Uint8Array(await readFile(/* turbopackIgnore: true */ target));
      if (maxBytes !== undefined && body.byteLength > maxBytes) throw new Error("storage: original local object exceeds its exact read bound");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const sha256 = digest(body), revision = localRevision(binding, key, sha256), record = await requestRecord(key);
    if (record && record.sha256 !== sha256) throw new Error("storage: local bytes differ from their original request generation");
    return {
      body,
      revision,
      contentType: record?.contentType ?? "application/octet-stream",
      ...(record ? { requestProof: { id: record.requestId, tokenDigest: record.tokenDigest } } : {}),
    };
  }

  async function readVersioned(key: string, expectedRevision?: TransferRevision, expectedBytes?: number) {
    const pinned = expectedRevision ? pinnedLocalRevision(expectedRevision, binding, key) : undefined;
    if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) throw new Error("storage: invalid exact local byte count");
    return observer({ kind: "object.read", binding, key, ...(pinned ? { expectedRevision: pinned } : {}), ...(expectedBytes !== undefined ? { bytes: expectedBytes } : {}) }, async notify => {
      const actual = await actualObject(key, expectedBytes);
      if (!actual) { await notify({ stage: "response", status: 404 }); await notify({ stage: "absence", status: 404 }); return undefined; }
      if (expectedBytes !== undefined && actual.body.byteLength !== expectedBytes) throw new Error("storage: original local object has a different byte count");
      if (pinned && !sameLocalRevision(actual.revision, pinned)) throw new Error("storage: original local bytes do not match their pinned generation");
      await notify({ stage: "response", status: 200 });
      await notify({ stage: "metadata", status: 200, revision: actual.revision, bytes: actual.body.byteLength, ...(actual.requestProof ? { requestProof: actual.requestProof } : {}) });
      await notify({ stage: "body", status: 200, revision: actual.revision, sha256: digest(actual.body), bytes: actual.body.byteLength });
      return { body: actual.body, contentType: actual.contentType, revision: actual.revision, ...(actual.requestProof ? { requestProof: actual.requestProof } : {}) };
    });
  }

  async function inventoryKeys(): Promise<string[]> {
    const keys: string[] = [];
    async function walk(directory: string, prefix = ""): Promise<void> {
      let rows;
      try { rows = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && directory === root) return; throw error; }
      rows.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const row of rows) {
        if (!prefix && row.name === REQUEST_DIRECTORY) continue;
        const key = prefix ? `${prefix}/${row.name}` : row.name;
        if (row.isDirectory()) await walk(localPath(root, key), key);
        else if (row.isFile()) keys.push(key);
        else throw new Error("storage: original local inventory contains a non-file entry");
      }
    }
    await walk(root);
    return keys;
  }

  return {
    binding,
    readVersioned,
    async get(key) { return (await readVersioned(key))?.body; },
    async put(key, body, contentType) {
      await observer({ kind: "object.put", binding, key, createOnly: true, sha256: digest(body), bytes: body.byteLength, contentType }, async (notify, identity) => {
        if (!identity) throw new Error("storage: accountable local writes require their original request identity");
        const target = localPath(root, key), recordPath = requestPath(key);
        try {
          await mkdir(dirname(target), { recursive: true });
          const handle = await open(/* turbopackIgnore: true */ target, "wx");
          try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
          await mkdir(dirname(recordPath), { recursive: true });
          const record: LocalRequestRecord = { key, namespace: binding.namespace, sha256: digest(body), contentType, requestId: identity.id, tokenDigest: tokenDigest(identity.token) };
          const recordHandle = await open(/* turbopackIgnore: true */ recordPath, "wx");
          try { await recordHandle.writeFile(JSON.stringify(record)); await recordHandle.sync(); } finally { await recordHandle.close(); }
        } catch (error) {
          await notify({ stage: "response", status: (error as NodeJS.ErrnoException).code === "EEXIST" ? 412 : null });
          throw error;
        }
        const revision = localRevision(binding, key, digest(body));
        await notify({ stage: "response", status: 200 });
        await notify({ stage: "metadata", status: 200, revision, bytes: body.byteLength, requestProof: { id: identity.id, tokenDigest: tokenDigest(identity.token) } });
        await notify({ stage: "accepted", status: 200 });
      });
    },
    async deleteVersioned(key, input) {
      const revision = pinnedLocalRevision(input, binding, key);
      await observer({ kind: "object.delete", binding, key, expectedRevision: revision }, async notify => {
        const actual = await actualObject(key);
        if (actual && !sameLocalRevision(actual.revision, revision)) {
          await notify({ stage: "response", status: 412 });
          throw new Error("storage: refusing to delete a different local generation");
        }
        await rm(localPath(root, key), { force: true });
        await rm(requestPath(key), { force: true });
        await notify({ stage: "response", status: actual ? 200 : 404 });
        if (!actual) await notify({ stage: "absence", status: 404 });
        await notify({ stage: "accepted", status: actual ? 200 : 404 });
      });
    },
    async metadataVersioned(key, expectedRevision) {
      const pinned = expectedRevision ? pinnedLocalRevision(expectedRevision, binding, key) : undefined;
      return observer({ kind: "object.metadata", binding, key, ...(pinned ? { expectedRevision: pinned } : {}) }, async notify => {
        const actual = await actualObject(key);
        if (!actual) { await notify({ stage: "response", status: 404 }); await notify({ stage: "absence", status: 404 }); return undefined; }
        if (pinned && !sameLocalRevision(actual.revision, pinned)) throw new Error("storage: original local metadata names another generation");
        await notify({ stage: "response", status: 200 });
        await notify({ stage: "metadata", status: 200, revision: actual.revision, bytes: actual.body.byteLength, ...(actual.requestProof ? { requestProof: actual.requestProof } : {}) });
        return { revision: actual.revision, bytes: actual.body.byteLength, contentType: actual.contentType, ...(actual.requestProof ? { requestProof: actual.requestProof } : {}) };
      });
    },
    async readDigestVersioned(key, input, maxBytes, originalParts) {
      if (originalParts !== undefined) throw new Error("storage: local storage has no original multipart readback capability");
      const pinned = pinnedLocalRevision(input, binding, key);
      return observer({ kind: "object.read", binding, key, expectedRevision: pinned, bytes: maxBytes }, async notify => {
        const actual = await actualObject(key, maxBytes);
        if (!actual) { await notify({ stage: "response", status: 404 }); await notify({ stage: "absence", status: 404 }); return undefined; }
        if (!sameLocalRevision(actual.revision, pinned)) throw new Error("storage: original local digest names another generation");
        await notify({ stage: "response", status: 200 });
        await notify({ stage: "metadata", status: 200, revision: actual.revision, ...(actual.requestProof ? { requestProof: actual.requestProof } : {}) });
        await notify({ stage: "body", status: 200, revision: actual.revision, sha256: digest(actual.body), bytes: actual.body.byteLength });
        return { sha256: digest(actual.body), bytes: actual.body.byteLength, contentType: actual.contentType, revision: actual.revision, ...(actual.requestProof ? { requestProof: actual.requestProof } : {}) };
      });
    },
    async inventoryPage(kind, cursor = null) {
      if (!["objects", "versions", "retained"].includes(kind) || (kind !== "objects" && cursor !== null)
        || cursor && (Object.keys(cursor).length !== 1 || typeof cursor.key !== "string" || !cursor.key)) throw new Error("storage: invalid original local inventory request");
      return observer({ kind: `inventory.${kind}`, binding, cursor }, async notify => {
        const entries: TransferInventoryEntry[] = []; let next: Record<string, string> | null = null;
        if (kind === "objects") {
          const keys = await inventoryKeys(), start = cursor ? keys.findIndex(key => key === cursor.key) + 1 : 0;
          if (cursor && start === 0) throw new Error("storage: original local inventory cursor is unavailable");
          const selected = keys.slice(start, start + MAX_PAGE);
          for (const key of selected) {
            const actual = await actualObject(key);
            if (actual) entries.push({ kind: "object", key, bytes: actual.body.byteLength, revision: actual.revision, current: true });
          }
          if (start + MAX_PAGE < keys.length) next = { key: selected.at(-1)! };
        }
        const result = { entries, next };
        await notify({ stage: "response", status: 200 });
        await notify({ stage: "inventory", status: 200, detailDigest: digest(result), count: entries.length });
        return result;
      });
    },
    async inventoryConfiguration() {
      return observer({ kind: "bucket.metadata", binding }, async notify => {
        const result = { versioning: "disabled" as const, softDeleteSeconds: 0, retentionSeconds: 0 };
        await notify({ stage: "response", status: 200 });
        await notify({ stage: "configuration", status: 200, detailDigest: digest(result) });
        return result;
      });
    },
  };
}

export function createLocalStorage(config: LocalConfig): StorageAdapter {
  const root = resolve(config.root);
  refuseInProduction(root);
  const pathFor = (key: string): string => localPath(root, key);
  const binding: StorageBinding = Object.freeze({ kind: "local", namespace: storageNamespace({ id: "local", root }), location: Object.freeze({ root }) });

  return {
    id: "local",
    writeProtocol: "single-put-v1",
    binding: async () => binding,
    // Objects are served by the app's /media route, which re-checks the
    // object inventory on every request; nothing reaches them directly.
    isPublic: false,

    async put(key, body, contentType, observation): Promise<StoredObject> {
      if (observation?.request) {
        let originalRevision: StoredObjectRevision | undefined;
        const request: TransferRequestObserver = (descriptor, operation) => observation.request!(descriptor, async (notify, identity) => operation(async (facts: TransferRequestObservation) => {
          await notify(facts);
          if (descriptor.kind === "object.put" && facts.stage === "metadata" && facts.revision) originalRevision = facts.revision;
        }, identity));
        const requests = createLocalRequestStore({ ...config, root }, request);
        await requests.put(key, body, contentType);
        if (!originalRevision) throw new Error("storage: original local generation was not retained");
        await observation.onAccepted?.({ revision: originalRevision });
        const actual = await requests.readVersioned(key, originalRevision, body.byteLength);
        if (!actual || actual.body.byteLength !== body.byteLength || digest(actual.body) !== digest(body)) throw new Error("storage: original local upload failed full-byte verification");
        return { key, bytes: body.byteLength, contentType };
      }
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      return { key, bytes: body.byteLength, contentType };
    },

    async get(key): Promise<Uint8Array<ArrayBuffer> | undefined> {
      try {
        return new Uint8Array(
          await readFile(/* turbopackIgnore: true */ pathFor(key)),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async head(key) {
      try {
        const facts = await stat(/* turbopackIgnore: true */ pathFor(key));
        return {
          key,
          bytes: facts.size,
          contentType: "application/octet-stream",
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async readRange(key, start, endInclusive) {
      try {
        const handle = await open(
          /* turbopackIgnore: true */ pathFor(key),
          "r",
        );
        try {
          const length = Math.max(0, endInclusive - start + 1);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, start);
          return new Uint8Array(buffer.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async stream(key) {
      try {
        await stat(/* turbopackIgnore: true */ pathFor(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      const source = createReadStream(
        /* turbopackIgnore: true */ pathFor(key),
      );
      return (async function* () {
        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          yield new Uint8Array(buffer);
        }
      })();
    },

    async verifyPhysicalAbsence(key): Promise<void> {
      // This adapter has no remote generations, trash or upload sessions.
      // Original writer receipts separately fence concurrent admissions.
      try { await stat(/* turbopackIgnore: true */ pathFor(key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      throw new Error("storage: the original local object is still present");
    },

    async delete(key): Promise<void> {
      // force: deleting what is not there already satisfies the caller.
      await rm(pathFor(key), { force: true });
      await rm(localRequestPath(root, key), { force: true });
    },

    async url(key): Promise<string> {
      return `${config.publicPath.replace(/\/+$/, "")}/${encodeURI(key)}`;
    },
  };
}
