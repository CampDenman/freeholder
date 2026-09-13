// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Offline capture file queue (MASTER.md §35.1, C10.18).
//
// This is the one write that may sit on the device: files, not decisions. It
// records consent, says which files have and have not been uploaded, and
// flushes through the same live capture contract C10.17 already uses. Pause,
// resume, cancel and retry are local controls over that queue — they are not a
// second media pipeline. The queue is bound to one instance and session so a
// later sign-in cannot upload somebody else's files.

import {
  CaptureUploadAborted,
  confirmCaptureSession,
  ingestCaptureUpload,
  isCaptureUploadAborted,
  openCaptureSession,
  type CaptureFile,
  type CaptureSource,
  type CaptureTransport,
} from "./capture.js";
import {
  isOfflineWriteException,
  OFFLINE_WRITE_EXCEPTION,
  OfflineWriteRefused,
  type Cache,
} from "./offline.js";

export const CAPTURE_DESTINATIONS = ["library", "product", "page"] as const;
export type CaptureDestinationKind = (typeof CAPTURE_DESTINATIONS)[number];

export type CaptureBatchStatus = "queued" | "uploading" | "paused" | "failed" | "cancelled" | "confirmed";
export type CaptureItemStatus = "queued" | "uploading" | "uploaded" | "failed" | "cancelled";

export interface CaptureConsent {
  grantedAt: string;
  notice: string;
}

export interface CaptureDestination {
  kind: CaptureDestinationKind;
  targetId?: string;
  label?: string;
}

export interface CaptureBatchItem {
  id: string;
  file: CaptureFile;
  status: CaptureItemStatus;
  progress: number;
  sessionId?: string;
  assetId?: string | null;
  error?: string;
}

export interface CaptureBatch {
  id: string;
  source: CaptureSource;
  destination: CaptureDestination;
  consent: CaptureConsent;
  status: CaptureBatchStatus;
  items: CaptureBatchItem[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface CaptureBatchProgress {
  uploaded: number;
  total: number;
  percent: number;
}

export interface FlushResult {
  flushed: number;
  confirmed: string[];
  reason?: "offline" | "empty";
}

export class CaptureBatchOwnerMismatch extends Error {
  constructor() {
    super("Those capture files belong to a different account.");
    this.name = "CaptureBatchOwnerMismatch";
  }
}

export function captureBatchOwner(input: { instanceUrl: string; token: string }): string {
  return `${input.instanceUrl}|${input.token}`;
}

export function captureBatchProgress(batch: CaptureBatch): CaptureBatchProgress {
  const total = batch.items.length;
  const uploaded = batch.items.filter((item) => item.status === "uploaded").length;
  const current = batch.items.find((item) => item.status === "uploading");
  const extra = current ? current.progress / 100 : 0;
  return {
    uploaded,
    total,
    percent: total === 0 ? 0 : Math.round(((uploaded + extra) / total) * 100),
  };
}

function cloneBatch(batch: CaptureBatch): CaptureBatch {
  return {
    ...batch,
    destination: { ...batch.destination },
    consent: { ...batch.consent },
    items: batch.items.map((item) => ({
      ...item,
      file: { ...item.file, bytes: item.file.bytes ? new Uint8Array(item.file.bytes) : undefined },
    })),
  };
}

function withoutBytes(batch: CaptureBatch): CaptureBatch {
  return {
    ...batch,
    items: batch.items.map((item) => ({
      ...item,
      file: { filename: item.file.filename, contentType: item.file.contentType, byteLength: item.file.byteLength, uri: item.file.uri },
    })),
  };
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function decodeBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function requireConsent(consent: CaptureConsent | undefined): CaptureConsent {
  if (!consent?.grantedAt || !consent.notice.trim()) {
    throw new Error("Capture consent is required before files can be queued.");
  }
  return consent;
}

function requireDestination(destination: CaptureDestination): CaptureDestination {
  if (!CAPTURE_DESTINATIONS.includes(destination.kind)) {
    throw new Error("Choose where these files should land.");
  }
  if (destination.kind !== "library" && !destination.targetId) {
    throw new Error("Choose where these files should land.");
  }
  return destination;
}

function fileForFlush(item: CaptureBatchItem, held: Map<string, Uint8Array>): CaptureFile {
  const bytes = held.get(item.id) ?? item.file.bytes;
  return { ...item.file, bytes };
}

interface PersistedQueue {
  owner: string;
  batches: CaptureBatch[];
  files: Record<string, string>;
}

export function createCaptureBatchStore(
  cache: Cache,
  options: {
    key?: string;
    now?: () => Date;
    id?: () => string;
    retainFile?: (file: CaptureFile, itemId: string) => Promise<CaptureFile>;
    releaseFile?: (file: CaptureFile) => Promise<void>;
    wipe?: () => Promise<void>;
  } = {},
) {
  const prefix = options.key ?? "freeholder.capture-batches";
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();
  const nextId = options.id ?? (() => globalThis.crypto.randomUUID());
  let owner: string | null = null;
  let batches: CaptureBatch[] = [];
  const files = new Map<string, Uint8Array>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let loaded = false;
  let inFlight: Promise<FlushResult> | null = null;

  function storageKey(forOwner: string): string {
    return `${prefix}|${forOwner}`;
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function snapshot(): CaptureBatch[] {
    return batches.map(cloneBatch);
  }

  function requireOwner(expected?: string): string {
    if (!owner || (expected !== undefined && expected !== owner)) {
      throw new CaptureBatchOwnerMismatch();
    }
    return owner;
  }

  async function persist() {
    if (!owner) return;
    const payload: PersistedQueue = {
      owner,
      batches: batches.map(withoutBytes),
      files: Object.fromEntries([...files.entries()].map(([id, bytes]) => [id, encodeBytes(bytes)])),
    };
    await cache.set(storageKey(owner), JSON.stringify(payload));
    notify();
  }

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    if (!owner) return;
    const raw = await cache.get(storageKey(owner)).catch(() => null);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedQueue;
      if (parsed.owner !== owner || !Array.isArray(parsed.batches)) return;
      batches = parsed.batches;
      files.clear();
      for (const [id, encoded] of Object.entries(parsed.files ?? {})) {
        files.set(id, decodeBytes(encoded));
      }
    } catch {
      batches = [];
      files.clear();
    }
  }

  function requireBatch(id: string): CaptureBatch {
    const batch = batches.find((entry) => entry.id === id);
    if (!batch) throw new Error("That capture batch is not on this device.");
    return batch;
  }

  async function releaseItem(item: CaptureBatchItem) {
    files.delete(item.id);
    await options.releaseFile?.(item.file).catch(() => {});
  }

  async function bind(next: string): Promise<void> {
    if (owner === next && loaded) return;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    owner = next;
    batches = [];
    files.clear();
    loaded = false;
    await ensureLoaded();
    notify();
  }

  async function clear(): Promise<void> {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    const previous = owner;
    batches = [];
    files.clear();
    loaded = true;
    if (previous) await cache.delete(storageKey(previous)).catch(() => {});
    await options.wipe?.().catch(() => {});
    owner = null;
    notify();
  }

  async function enqueue(input: {
    source: CaptureSource;
    files: CaptureFile[];
    destination: CaptureDestination;
    consent: CaptureConsent;
    owner: string;
  }): Promise<CaptureBatch> {
    if (!isOfflineWriteException(OFFLINE_WRITE_EXCEPTION)) {
      throw new OfflineWriteRefused(input.source);
    }
    requireOwner(input.owner);
    await ensureLoaded();
    const consent = requireConsent(input.consent);
    const destination = requireDestination(input.destination);
    const incoming = input.files.filter((file) => (file.byteLength || file.bytes?.byteLength || 0) > 0);
    if (incoming.length === 0) throw new Error("An empty file cannot be stored.");
    const createdAt = nowIso();
    const items: CaptureBatchItem[] = [];
    for (const file of incoming) {
      const id = nextId();
      const retained = options.retainFile ? await options.retainFile(file, id) : file;
      if (retained.bytes) files.set(id, retained.bytes);
      items.push({
        id,
        file: {
          filename: retained.filename,
          contentType: retained.contentType,
          byteLength: retained.byteLength || retained.bytes?.byteLength || 0,
          uri: retained.uri,
        },
        status: "queued",
        progress: 0,
      });
    }
    const batch: CaptureBatch = {
      id: nextId(),
      source: input.source,
      destination,
      consent,
      status: "queued",
      items,
      createdAt,
      updatedAt: createdAt,
    };
    batches = [...batches, batch];
    await persist();
    return cloneBatch(batch);
  }

  async function pause(id: string): Promise<CaptureBatch> {
    await ensureLoaded();
    requireOwner();
    const batch = requireBatch(id);
    controllers.get(id)?.abort();
    if (batch.status === "confirmed" || batch.status === "cancelled") return cloneBatch(batch);
    batch.status = "paused";
    batch.updatedAt = nowIso();
    batch.error = undefined;
    for (const item of batch.items) {
      if (item.status === "uploading") {
        item.status = "queued";
        item.progress = 0;
        item.error = undefined;
      }
    }
    await persist();
    return cloneBatch(batch);
  }

  async function resume(id: string): Promise<CaptureBatch> {
    await ensureLoaded();
    requireOwner();
    const batch = requireBatch(id);
    if (batch.status === "confirmed" || batch.status === "cancelled") return cloneBatch(batch);
    batch.status = "queued";
    batch.updatedAt = nowIso();
    batch.error = undefined;
    for (const item of batch.items) {
      if (item.status === "failed") {
        item.status = "queued";
        item.progress = 0;
        item.error = undefined;
      }
    }
    await persist();
    return cloneBatch(batch);
  }

  async function cancel(id: string): Promise<CaptureBatch> {
    await ensureLoaded();
    requireOwner();
    const batch = requireBatch(id);
    controllers.get(id)?.abort();
    if (batch.status === "confirmed") return cloneBatch(batch);
    batch.status = "cancelled";
    batch.updatedAt = nowIso();
    batch.error = undefined;
    for (const item of batch.items) {
      if (item.status !== "uploaded") {
        item.status = "cancelled";
        item.progress = 0;
        item.error = undefined;
        await releaseItem(item);
      }
    }
    await persist();
    return cloneBatch(batch);
  }

  async function retry(id: string): Promise<CaptureBatch> {
    await ensureLoaded();
    requireOwner();
    const batch = requireBatch(id);
    if (batch.status === "confirmed" || batch.status === "cancelled") return cloneBatch(batch);
    batch.status = "queued";
    batch.updatedAt = nowIso();
    batch.error = undefined;
    for (const item of batch.items) {
      if (item.status === "failed") {
        item.status = "queued";
        item.progress = 0;
        item.error = undefined;
      }
    }
    await persist();
    return cloneBatch(batch);
  }

  async function runFlush(input: { online: boolean; transport: CaptureTransport; owner: string }): Promise<FlushResult> {
    requireOwner(input.owner);
    await ensureLoaded();
    if (!input.online) return { flushed: 0, confirmed: [], reason: "offline" };
    const pending = batches.filter((batch) => batch.status === "queued" || batch.status === "uploading");
    if (pending.length === 0) return { flushed: 0, confirmed: [], reason: "empty" };
    const confirmed: string[] = [];
    let flushed = 0;
    for (const batch of pending) {
      if (batch.status === "paused" || batch.status === "cancelled") continue;
      const controller = new AbortController();
      controllers.set(batch.id, controller);
      batch.status = "uploading";
      batch.updatedAt = nowIso();
      batch.error = undefined;
      await persist();
      try {
        for (const item of batch.items) {
          if (controller.signal.aborted) throw new CaptureUploadAborted();
          if (item.status === "uploaded" || item.status === "cancelled") continue;
          item.status = "uploading";
          item.progress = 0;
          item.error = undefined;
          batch.updatedAt = nowIso();
          await persist();
          const session = await openCaptureSession(
            {
              source: batch.source,
              online: input.online,
              targetType: batch.destination.kind,
              ...(batch.destination.targetId ? { targetId: batch.destination.targetId } : {}),
            },
            input.transport,
          );
          item.sessionId = session.id;
          const staged = await ingestCaptureUpload(
            {
              session,
              file: fileForFlush(item, files),
              online: input.online,
              signal: controller.signal,
              onProgress: (progress) => {
                item.progress = progress.totalBytes === 0 ? 100 : Math.min(99, Math.round((progress.uploadedBytes / progress.totalBytes) * 100));
                notify();
              },
            },
            input.transport,
          );
          const confirmedSession = await confirmCaptureSession(
            { session: staged, online: input.online },
            input.transport,
          );
          item.status = "uploaded";
          item.progress = 100;
          item.assetId = confirmedSession.assetId ?? staged.assetId ?? null;
          item.sessionId = confirmedSession.id;
          await releaseItem(item);
          flushed += 1;
          batch.updatedAt = nowIso();
          await persist();
        }
        if (batch.items.every((item) => item.status === "uploaded" || item.status === "cancelled")) {
          batch.status = batch.items.some((item) => item.status === "uploaded") ? "confirmed" : "cancelled";
          batch.updatedAt = nowIso();
          if (batch.status === "confirmed") confirmed.push(batch.id);
          await persist();
        }
      } catch (error) {
        const latest = requireBatch(batch.id);
        if (isCaptureUploadAborted(error) || latest.status === "paused" || latest.status === "cancelled") {
          if (latest.status === "uploading") latest.status = "paused";
          for (const item of latest.items) {
            if (item.status === "uploading") {
              item.status = "queued";
              item.progress = 0;
            }
          }
          latest.updatedAt = nowIso();
          await persist();
          continue;
        }
        if (error instanceof OfflineWriteRefused) {
          latest.status = "queued";
          for (const item of latest.items) {
            if (item.status === "uploading") {
              item.status = "queued";
              item.progress = 0;
            }
          }
          latest.updatedAt = nowIso();
          await persist();
          return { flushed, confirmed, reason: "offline" };
        }
        const message = error instanceof Error ? error.message : String(error);
        latest.status = "failed";
        latest.error = message;
        latest.updatedAt = nowIso();
        for (const item of latest.items) {
          if (item.status === "uploading") {
            item.status = "failed";
            item.error = message;
          }
        }
        await persist();
      } finally {
        controllers.delete(batch.id);
      }
    }
    return { flushed, confirmed };
  }

  async function flush(input: { online: boolean; transport: CaptureTransport; owner: string }): Promise<FlushResult> {
    requireOwner(input.owner);
    while (inFlight) await inFlight;
    inFlight = runFlush(input).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    bind,
    clear,
    async list() {
      await ensureLoaded();
      return snapshot();
    },
    snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enqueue,
    pause,
    resume,
    cancel,
    retry,
    flush,
    progress(id: string) {
      const batch = batches.find((entry) => entry.id === id);
      if (!batch) return { uploaded: 0, total: 0, percent: 0 };
      return captureBatchProgress(batch);
    },
    async get(id: string) {
      await ensureLoaded();
      return cloneBatch(requireBatch(id));
    },
  };
}

export type CaptureBatchStore = ReturnType<typeof createCaptureBatchStore>;
