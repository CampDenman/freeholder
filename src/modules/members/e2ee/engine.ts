// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: one device's side of end-to-end encrypted messages. The same code
// runs in the browser (IndexedDB store, server-action transport) and in tests
// (memory store, services called directly), so what the tests prove is what
// members run.
//
// The device keeps its keys, each conversation's MLS group state, and the
// messages it has read; the server sees only ciphertext. Before sending, a
// device makes the group hold exactly the devices the server says should read
// it — but it accepts a device only if its credential carries the signature
// key the directory published for it.
import type { PrivateKeyPackage } from "ts-mls";
import { openMls } from "./crypto";
import { deliveryAuthority } from "./authority";
import { joinLegacy, legacyDevices, loadLegacy, migrationInfo, processLegacy, saveLegacy, type LegacyState } from "./legacy";
import { b64, deviceCode, digitGroups, frankTag, historyStatement, openCallKey, openPayload, sameTag, sealCallKey, sealPayload, sign, verify, unb64, utf8, fromUtf8, type SealedFile } from "./wire";

export interface DeviceRecord {
  deviceId: string;
  userId: string;
  signKey: Uint8Array;
  publicKey: Uint8Array;
  /** Until the server confirms, the packages to register it with. */
  pending?: { keyPackageIds: string[]; lastResortId: string };
}

export interface StoredKeyPackage {
  id: string;
  publicPackage: string;
  privatePackage: PrivateKeyPackage | string;
  lastResort: boolean;
}

/** A message this device has read, or could not. */
export interface ReadMessage {
  body: string;
  /** The franking key; revealing it with the body is how a recipient reports. */
  fk: string;
  senderUserId: string;
  /** False when it failed to decrypt or did not match its franking tag. */
  ok: boolean;
  /** C12.36: encrypted files, with the keys to open them. */
  files?: SealedFile[];
}

export interface E2eeStore {
  device(): Promise<DeviceRecord | null>;
  saveDevice(device: DeviceRecord): Promise<void>;
  keyPackage(id: string): Promise<StoredKeyPackage | null>;
  saveKeyPackages(packages: StoredKeyPackage[]): Promise<void>;
  dropKeyPackage(id: string): Promise<void>;
  group(conversationId: string): Promise<{ state: Uint8Array | null; cursor: number } | null>;
  saveGroup(conversationId: string, state: Uint8Array | null, cursor: number): Promise<void>;
  messages(conversationId: string): Promise<Map<string, ReadMessage>>;
  saveMessage(conversationId: string, id: string, message: ReadMessage): Promise<void>;
  dropMessage(conversationId: string, id: string): Promise<void>;
  /** C12.24: a group call's media key, base64. */
  callKey(callId: string): Promise<string | null>;
  saveCallKey(callId: string, key: string): Promise<void>;
  /** C12.34: the private half of this device's history request key, while one is open. */
  historyKey(): Promise<Uint8Array | null>;
  saveHistoryKey(key: Uint8Array | null): Promise<void>;
  /** Conversations this device has read messages in. */
  conversations(): Promise<string[]>;
  /** C12.35: the devices this member last saw verified in a conversation. */
  seenDevices(conversationId: string): Promise<string[] | null>;
  saveSeenDevices(conversationId: string, devices: string[]): Promise<void>;
  /** Forget everything: the device was removed. */
  clear(): Promise<void>;
}

type DeviceEntry = { deviceId: string; userId: string; signatureKey: string };
type LogEntry = { seq: number; epoch: number; kind: "commit" | "welcome" | "application" | "control"; senderDeviceId: string | null; keyPackageId: string | null; messageId: string | null; callId: string | null; callGeneration: number | null; frankTag: string | null; payload: string };
export interface SyncResult {
  available: boolean;
  supportsOpenMlsRefresh?: boolean;
  deliveryFenceVersion?: 1;
  missing: string[];
  epoch: number | null;
  inGroup: boolean;
  roster: string[];
  entitled: DeviceEntry[];
  directory: DeviceEntry[];
  log: LogEntry[];
  more: boolean;
  unclaimed: number;
  calls: { callId: string; generation: number; needsKey: boolean }[];
}

/** The services, however they are reached. Failures throw an error with a `code`. */
export interface E2eeTransport {
  register(input: { deviceId: string; label: string; signatureKey: string; keyPackages: { id: string; keyPackage: string }[]; lastResort: { id: string; keyPackage: string } }): Promise<unknown>;
  publish(input: { deviceId: string; keyPackages: { id: string; keyPackage: string }[] }): Promise<unknown>;
  sync(input: { conversationId: string; deviceId: string; after: number }): Promise<SyncResult>;
  claim(input: { conversationId: string; deviceId: string; devices: string[] }): Promise<{ packages: { deviceId: string; keyPackageId: string; keyPackage: string }[] }>;
  commit(input: { conversationId: string; deviceId: string; create: boolean; refresh?: boolean; fromEpoch: number; authority: string; commit: string; welcome?: string; added: { deviceId: string; keyPackageId: string }[]; removed: string[] }): Promise<{ epoch: number }>;
  send(input: { conversationId: string; deviceId: string; epoch: number; authority: string; ciphertext: string; frankTag: string; attachments: { assetId: string; altText: string }[]; sealedFiles?: string[] }): Promise<{ id: string }>;
  sendCallKey(input: { conversationId: string; deviceId: string; epoch: number; authority: string; callId: string; generation: number; fresh: boolean; ciphertext: string }): Promise<unknown>;
  requestHistory(input: { deviceId: string; publicKey: string; sig: string }): Promise<{ id: string }>;
  historyRequests(input: { deviceId: string }): Promise<{ requests: { id: string; deviceId: string; label: string; signatureKey: string; publicKey: string; sig: string }[] }>;
  sendHistory(input: { requestId: string; deviceId: string; conversationId: string; enc: string; ct: string }): Promise<unknown>;
  closeHistory(input: { requestId: string }): Promise<unknown>;
  receivedHistory(input: { deviceId: string }): Promise<{ transfers: { id: string; requestId: string; conversationId: string; enc: string; ct: string }[] }>;
  ackHistory(input: { deviceId: string; ids: string[] }): Promise<unknown>;
}

export interface ConversationState {
  /** Everyone has a device, so the conversation is (or can be) encrypted. */
  available: boolean;
  /** This device is in the group and can read and send. */
  ready: boolean;
  missing: string[];
  messages: Map<string, ReadMessage>;
  /** C12.24/37: calls going on here, and which key generation each is on. */
  calls: { callId: string; generation: number }[];
}

const BATCH = 50;
const LOW_WATER = 10;
const RETRIES = 4;

export interface VerifiedDevice {
  userId: string;
  deviceId: string;
  signatureKey: string;
  /** Groups of five digits identifying this one device's key. */
  fingerprint: string;
}

export interface Verification {
  /** Groups of five digits; the same for everyone who sees the same devices. */
  number: string;
  devices: VerifiedDevice[];
  changed: { added: string[]; removed: string[] };
}

/** C12.34: one of the member's other devices asking for their history. */
export interface HistoryAsk {
  id: string;
  label: string;
  /** The code the asking device shows; the member compares it before approving. */
  code: string;
  publicKey: string;
}

const HISTORY_INFO = utf8("freeholder:history:v1");
/** Kept well under a server action's body limit once sealed and base64-encoded. */
const HISTORY_CHUNK_BYTES = 400_000;

/** Where a call's key for one generation is kept on the device. */
const keySlot = (callId: string, generation: number) => (generation === 0 ? callId : `${callId}#${generation}`);

const codeOf = (error: unknown): string | undefined => (error && typeof error === "object" && "code" in error ? String(error.code) : undefined);

type CommitInput = Parameters<E2eeTransport["commit"]>[0];
type NativeGroup = { state: string; epoch: number; members: string[]; devices: DeviceEntry[]; active: boolean; pending: { fromEpoch: number; roster: string[]; commit: string; welcome: string | null } | null; payload?: string | null; sender?: string; message?: string };
type Outgoing = { conversationId: string; deviceId: string; epoch: number; ciphertext: string } & (
  | { kind: "application"; frankTag: string; read: ReadMessage }
  | { kind: "control"; callId: string; generation: number; key: string }
);
type OpenGroup = { kind: "openmls"; value: NativeGroup; request?: CommitInput; backup?: string; outgoing?: Outgoing[] };
type Group = OpenGroup | { kind: "legacy"; value: LegacyState };
export const MAX_UNCONFIRMED_OUTGOING = 32;
const EXPLICIT_REFUSALS = new Set(["validation", "permission", "not_found", "conflict", "rate_limited", "step_up_required"]);
function nativeGroup(before: Group | null, value: NativeGroup): OpenGroup {
  const prior = before?.kind === "openmls" ? before : undefined;
  const samePending = value.pending && value.pending.commit === prior?.value.pending?.commit;
  return { kind: "openmls", value, ...(prior?.outgoing?.length ? { outgoing: prior.outgoing } : {}), ...(samePending && prior?.request ? { request: prior.request, ...(prior.backup ? { backup: prior.backup } : {}) } : {}) };
}
function validOutgoing(value: unknown, conversationId: string, userId: string): value is Outgoing {
  if (!value || typeof value !== "object") return false;
  const sent = value as Outgoing;
  if (sent.conversationId !== conversationId || typeof sent.deviceId !== "string" || !/^[0-9a-f-]{36}$/.test(sent.deviceId) || !Number.isSafeInteger(sent.epoch) || sent.epoch < 1 || typeof sent.ciphertext !== "string" || sent.ciphertext.length > 120_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(sent.ciphertext)) return false;
  if (sent.kind === "application") return Boolean(sent.read && typeof sent.read.body === "string" && sent.read.body.length <= 10_000 && typeof sent.read.fk === "string" && /^[A-Za-z0-9+/]{43}=$/.test(sent.read.fk) && sent.read.senderUserId === userId && sent.read.ok === true && /^[A-Za-z0-9+/]{43}=$/.test(sent.frankTag));
  return sent.kind === "control" && typeof sent.callId === "string" && /^[0-9a-f-]{36}$/.test(sent.callId) && Number.isSafeInteger(sent.generation) && sent.generation >= 0 && typeof sent.key === "string" && /^[A-Za-z0-9+/]{43}=$/.test(sent.key);
}
const MARKER = "freeholder:openmls:v1\n";
const queues = new WeakMap<E2eeStore, Map<string, Promise<unknown>>>();
const conflict = () => Object.assign(new Error("The conversation changed; try again."), { code: "conflict" });
const epochOf = (group: Group) => group.kind === "openmls" ? (group.value.pending?.fromEpoch ?? group.value.epoch) : Number(group.value.groupContext.epoch);
const devicesOf = (group: Group): DeviceEntry[] => group.kind === "openmls" ? group.value.devices : legacyDevices(group.value);
const membersOf = (group: Group) => devicesOf(group).map((d) => d.deviceId);

export class E2eeDevice {


  constructor(
    private readonly userId: string,
    private readonly store: E2eeStore,
    private readonly transport: E2eeTransport,
    private readonly label: string,
  ) {}

  /** One operation at a time per conversation: group state moves strictly forward. */
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const locked = async (): Promise<T> => {
      if (typeof window !== "undefined") {
        if (!navigator.locks) throw Object.assign(new Error("This browser cannot coordinate encrypted device state across tabs."), { code: "not_ready" });
        return await navigator.locks.request(`freeholder:e2ee:${this.userId}:${key}`, work);
      }
      return work();
    };
    const queue = queues.get(this.store) ?? new Map<string, Promise<unknown>>();
    queues.set(this.store, queue);
    const next = (queue.get(key) ?? Promise.resolve()).catch(() => undefined).then(locked);
    queue.set(key, next);
    return next;
  }

  private identity(device: DeviceRecord) {
    return { userId: device.userId, deviceId: device.deviceId, privateKey: b64(device.signKey), publicKey: b64(device.publicKey) };
  }
  private context(conversationId: string, device: DeviceRecord, sync: SyncResult, expectedRoster?: string[]) {
    return { groupId: conversationId, identity: this.identity(device), directory: sync.directory, entitled: sync.entitled.map((d) => d.deviceId), serverEpoch: sync.epoch ?? 0, ...(expectedRoster ? { expectedRoster } : {}) };
  }
  private async newKeyPackages(device: DeviceRecord, count: number, lastResort = false): Promise<StoredKeyPackage[]> {
    const made: StoredKeyPackage[] = [];
    for (let i = 0; i < count; i++) {
      const kp = await openMls<{ publicPackage: string; state: string }>({ op: "makeKeyPackage", identity: this.identity(device), lastResort });
      made.push({ id: crypto.randomUUID(), publicPackage: kp.publicPackage, privatePackage: kp.state, lastResort });
    }
    return made;
  }

  /** This browser's device, registering it the first time. */
  async device(): Promise<DeviceRecord> {
    return this.serial("device", async () => {
      const existing = await this.store.device();
      if (existing && existing.userId === this.userId && !existing.pending) return existing;
      let device = existing?.userId === this.userId ? existing : null;
      if (!device) {
        if (existing) await this.store.clear();
        const generated = await openMls<{ privateKey: string; publicKey: string }>({ op: "generateKeys" });
        const keys = { signKey: unb64(generated.privateKey), publicKey: unb64(generated.publicKey) };
        const fresh: DeviceRecord = { deviceId: crypto.randomUUID(), userId: this.userId, signKey: keys.signKey, publicKey: keys.publicKey };
        const packages = await this.newKeyPackages(fresh, BATCH);
        const [lastResort] = await this.newKeyPackages(fresh, 1, true);
        // Everything is kept on the device before anything is published, so a
        // page that closes mid-way resumes this device instead of making another.
        await this.store.saveKeyPackages([...packages, lastResort!]);
        device = { ...fresh, pending: { keyPackageIds: packages.map((p) => p.id), lastResortId: lastResort!.id } };
        await this.store.saveDevice(device);
      }
      const pending = device.pending!;
      const stored = await Promise.all([...pending.keyPackageIds, pending.lastResortId].map((id) => this.store.keyPackage(id)));
      const publish = stored.filter((p): p is StoredKeyPackage => Boolean(p)).map((p) => ({ id: p.id, keyPackage: p.publicPackage, lastResort: p.lastResort }));
      const lastResort = publish.find((p) => p.lastResort);
      if (!lastResort) throw new Error("This device's keys are incomplete.");
      await this.transport.register({
        deviceId: device.deviceId,
        label: this.label,
        signatureKey: b64(device.publicKey),
        keyPackages: publish.filter((p) => !p.lastResort).map(({ id, keyPackage }) => ({ id, keyPackage })),
        lastResort: { id: lastResort.id, keyPackage: lastResort.keyPackage },
      });
      const registered: DeviceRecord = { deviceId: device.deviceId, userId: device.userId, signKey: device.signKey, publicKey: device.publicKey };
      await this.store.saveDevice(registered);
      return registered;
    });
  }

  private async load(conversationId: string, directory: DeviceEntry[]): Promise<{ state: Group | null; cursor: number }> {
    const saved = await this.store.group(conversationId);
    if (!saved?.state) return { state: null, cursor: saved?.cursor ?? 0 };
    if (saved.state.byteLength > 32 * 1024 * 1024) throw new Error("The saved encryption state exceeds its bound.");
    const text = fromUtf8(saved.state);
    if (text.startsWith(MARKER)) {
      const state = JSON.parse(text.slice(MARKER.length)) as Group;
      if (state.kind !== "openmls" || typeof state.value?.state !== "string") throw new Error("Invalid saved encryption state.");
      if (state.outgoing !== undefined && (!Array.isArray(state.outgoing) || state.outgoing.length > MAX_UNCONFIRMED_OUTGOING || state.outgoing.some(sent => !validOutgoing(sent, conversationId, this.userId)) || new Set(state.outgoing.map(sent => sent.ciphertext)).size !== state.outgoing.length)) throw new Error("Invalid saved pending delivery state.");
      return { state, cursor: saved.cursor };
    }
    return { state: { kind: "legacy", value: loadLegacy(saved.state, directory) }, cursor: saved.cursor };
  }
  private async save(conversationId: string, state: Group | null, cursor: number) {
    const bytes = !state ? null : state.kind === "legacy" ? saveLegacy(state.value) : utf8(MARKER + JSON.stringify(state));
    if (bytes && bytes.byteLength > 32 * 1024 * 1024) throw Object.assign(new Error("The saved encryption state exceeds its bound."), { code: "not_ready" });
    await this.store.saveGroup(conversationId, bytes, cursor);
  }
  private assertOutgoingRoom(state: OpenGroup) {
    if ((state.outgoing?.length ?? 0) >= MAX_UNCONFIRMED_OUTGOING) throw Object.assign(new Error("This device has too many unconfirmed sends. Reconnect and check the conversation before sending again."), { code: "not_ready" });
  }
  private async settleOutgoing(conversationId: string, device: DeviceRecord, candidate: Outgoing, messageId?: string, refused = false): Promise<void> {
    const currentDevice = await this.store.device();
    if (currentDevice?.userId !== device.userId || currentDevice.deviceId !== device.deviceId) return;
    const { state, cursor } = await this.load(conversationId, []);
    if (!state || state.kind !== "openmls" || !state.outgoing?.some(sent => sent.ciphertext === candidate.ciphertext)) return;
    if (!refused) {
      if (candidate.kind === "application") {
        if (!messageId) throw new Error("The message receipt is incomplete.");
        await this.store.saveMessage(conversationId, messageId, candidate.read);
      } else await this.store.saveCallKey(keySlot(candidate.callId, candidate.generation), candidate.key);
    }
    await this.save(conversationId, { ...state, outgoing: state.outgoing.filter(sent => sent.ciphertext !== candidate.ciphertext) }, cursor);
  }
  private async ownReceipt(conversationId: string, device: DeviceRecord, state: OpenGroup, entry: LogEntry): Promise<OpenGroup> {
    const candidate = state.outgoing?.find(sent => sent.ciphertext === entry.payload);
    if (!candidate) return state;
    if (candidate.conversationId !== conversationId || candidate.deviceId !== device.deviceId || entry.senderDeviceId !== device.deviceId || candidate.epoch !== entry.epoch || candidate.kind !== entry.kind) throw new Error("The encrypted delivery receipt does not match this device's pending send.");
    if (candidate.kind === "application") {
      if (!entry.messageId || entry.frankTag !== candidate.frankTag) throw new Error("The encrypted message receipt does not match its pending send.");
      await this.store.saveMessage(conversationId, entry.messageId, candidate.read);
    } else {
      if (entry.callId !== candidate.callId || (entry.callGeneration ?? 0) !== candidate.generation) throw new Error("The encrypted call receipt does not match its pending send.");
      await this.store.saveCallKey(keySlot(candidate.callId, candidate.generation), candidate.key);
    }
    return { ...state, outgoing: state.outgoing!.filter(sent => sent.ciphertext !== candidate.ciphertext) };
  }

  private ready(state: Group | null, sync: SyncResult | null): boolean {
    if (!state || state.kind !== "openmls" || state.value.pending || !state.value.active || !sync?.supportsOpenMlsRefresh || sync.deliveryFenceVersion !== 1 || !sync.inGroup || state.value.epoch !== sync.epoch) return false;
    const members = membersOf(state);
    return members.length === sync.entitled.length && sync.entitled.every((d) => members.includes(d.deviceId) && state.value.devices.some((leaf) => leaf.deviceId === d.deviceId && leaf.userId === d.userId && leaf.signatureKey === d.signatureKey));
  }

  /** Apply everything new in the log, then make the group match who should read it. */
  async sync(conversationId: string): Promise<ConversationState> {
    const device = await this.device();
    return this.serial(conversationId, async () => {
      let result: SyncResult | null = null;
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        result = await this.catchUp(conversationId, device);
        if (!result.available) break;
        try {
          if (!(await this.reconcile(conversationId, device, result))) break;
        } catch (error) {
          if (codeOf(error) !== "conflict") throw error;
        }
      }
      if (result && result.unclaimed < LOW_WATER) await this.topUp(device);
      const current = await this.load(conversationId, result?.directory ?? []);
      if (this.ready(current.state, result)) await this.tendCallKeys(conversationId, device, result!.calls);
      const { state } = await this.load(conversationId, result?.directory ?? []);
      const fresh = result ? await this.transport.sync({ conversationId, deviceId: device.deviceId, after: Number.MAX_SAFE_INTEGER }) : null;
      return {
        available: fresh?.available ?? false,
        ready: this.ready(state, fresh),
        missing: fresh?.missing ?? [],
        messages: await this.store.messages(conversationId),
        calls: (fresh?.calls ?? []).map(({ callId, generation }) => ({ callId, generation })),
      };
    });
  }

  private async topUp(device: DeviceRecord) {
    const packages = await this.newKeyPackages(device, BATCH);
    await this.store.saveKeyPackages(packages);
    await this.transport.publish({ deviceId: device.deviceId, keyPackages: packages.map((p) => ({ id: p.id, keyPackage: p.publicPackage })) });
  }

  private async catchUp(conversationId: string, device: DeviceRecord): Promise<SyncResult> {
    let result: SyncResult;
    let { state, cursor } = await this.load(conversationId, []);
    let replayed = false;
    do {
      result = await this.transport.sync({ conversationId, deviceId: device.deviceId, after: cursor });
      // An older client skipped public resync commits. Re-read the retained
      // log from its last crypto epoch, preserving already readable messages.
      if (!replayed && state && state.kind === "legacy" && result.epoch !== null && epochOf(state) < result.epoch) {
        cursor = 0; replayed = true;
        result = await this.transport.sync({ conversationId, deviceId: device.deviceId, after: cursor });
      }
      const context = this.context(conversationId, device, result);
      for (const entry of result.log) {
        if (state?.kind === "openmls" && state.value.pending && entry.kind === "commit" && entry.epoch === state.value.pending.fromEpoch) {
          if (entry.payload === state.value.pending.commit && entry.senderDeviceId === device.deviceId) {
            state = nativeGroup(state, await openMls<NativeGroup>({ op: "acceptPending", context, state: state.value.state, commit: entry.payload }));
            await this.save(conversationId, state, entry.seq); cursor = entry.seq; continue;
          }
          if (state.backup) state = { kind: "legacy", value: loadLegacy(unb64(state.backup), result.directory) };
          else state = nativeGroup(state, await openMls<NativeGroup>({ op: "abandonPending", context, state: state.value.state }));
          await this.save(conversationId, state, cursor);
        }
        if (entry.senderDeviceId === device.deviceId && entry.kind !== "welcome") {
          if (state?.kind === "openmls" && (entry.kind === "application" || entry.kind === "control")) state = await this.ownReceipt(conversationId, device, state, entry);
          cursor = entry.seq; await this.save(conversationId, state, cursor); continue;
        }
        if (entry.kind === "welcome") {
          // Never replace a newer state with a historical Welcome on replay.
          if (!state || epochOf(state) < entry.epoch) {
            const kp = entry.keyPackageId ? await this.store.keyPackage(entry.keyPackageId) : null;
            if (!kp) throw new Error("This device's welcome key is missing.");
            if (typeof kp.privatePackage === "string") state = nativeGroup(state, await openMls<NativeGroup>({ op: "join", context, state: kp.privatePackage, welcome: entry.payload }));
            else state = { kind: "legacy", value: await joinLegacy(entry.payload, kp.publicPackage, kp.privatePackage, result.directory) };
            // Persist the joined state before consuming a one-time package.
            await this.save(conversationId, state, entry.seq);
            if (!kp.lastResort) await this.store.dropKeyPackage(kp.id);
          }
        } else if (state && entry.epoch >= epochOf(state)) {
          let plaintext: Uint8Array | null = null;
          let senderIdentity: string | undefined;
          try {
            if (state.kind === "openmls") {
              const processed = await openMls<NativeGroup>({ op: "process", context, state: state.value.state, message: entry.payload });
              state = nativeGroup(state, processed);
              plaintext = processed.payload ? unb64(processed.payload) : null;
              senderIdentity = processed.sender;
            } else {
              const processed = await processLegacy(state.value, entry.payload, result.directory);
              state = { kind: "legacy", value: processed.newState };
              if ("kind" in processed && processed.kind === "applicationMessage") plaintext = processed.message;
            }
          } catch (error) {
            // A critical epoch transition must never be silently skipped.
            if (entry.kind === "commit" || entry.kind === "control") throw error;
            if (entry.messageId && !(await this.store.messages(conversationId)).get(entry.messageId)?.ok) await this.store.saveMessage(conversationId, entry.messageId, { body: "", fk: "", senderUserId: "", ok: false });
          }
          if (plaintext) {
            const sender = [...result.directory, ...devicesOf(state)].find((d) => d.deviceId === entry.senderDeviceId && (!senderIdentity || senderIdentity === `${d.userId}:${d.deviceId}`));
            if (entry.kind === "control" && entry.callId) {
              const generation = entry.callGeneration ?? 0;
              const key = sender ? await openCallKey(conversationId, entry.callId, generation, plaintext, { deviceId: sender.deviceId, signatureKey: unb64(sender.signatureKey) }) : null;
              if (key) await this.store.saveCallKey(keySlot(entry.callId, generation), key);
            } else if (entry.messageId) {
              const payload = sender ? await openPayload(conversationId, plaintext, { deviceId: sender.deviceId, signatureKey: unb64(sender.signatureKey) }) : null;
              const matches = Boolean(payload && sender && entry.frankTag && sameTag(await frankTag(unb64(payload.fk), conversationId, sender.userId, payload.body), entry.frankTag));
              if (matches || !(await this.store.messages(conversationId)).get(entry.messageId)?.ok) await this.store.saveMessage(conversationId, entry.messageId, matches ? { body: payload!.body, fk: payload!.fk, senderUserId: sender!.userId, ok: true, ...(payload!.files ? { files: payload!.files } : {}) } : { body: "", fk: "", senderUserId: "", ok: false });
            }
          }
        }
        cursor = entry.seq;
        await this.save(conversationId, state, cursor);
      }
    } while (result.more);
    // Retry an uncertain transport outcome with the identical prepared commit.
    if (state?.kind === "openmls" && state.request && result.supportsOpenMlsRefresh && result.deliveryFenceVersion === 1) {
      if (result.epoch === state.request.fromEpoch || (state.request.create && result.epoch === null)) {
        if (state.request.authority !== await deliveryAuthority(conversationId, result)) {
          // Erasure can change authority without advancing the MLS epoch.
          // Discard only the unaccepted commit, preserving sender ratchets.
          state = state.backup ? { kind: "legacy", value: loadLegacy(unb64(state.backup), result.directory) } : nativeGroup(state, await openMls<NativeGroup>({ op: "abandonPending", context: this.context(conversationId, device, result), state: state.value.state }));
          await this.save(conversationId, state, cursor);
        } else await this.deliverPending(conversationId, device, state, cursor, result);
      }
      else if (state.value.pending) throw conflict();
    }
    return result;
  }

  private async deliverPending(conversationId: string, device: DeviceRecord, state: Extract<Group, { kind: "openmls" }>, cursor: number, sync: SyncResult) {
    if (!state.request || !state.value.pending) throw new Error("Missing prepared commit.");
    const receipt = await this.transport.commit(state.request);
    if (receipt.epoch !== state.value.pending.fromEpoch + 1) throw new Error("Invalid commit receipt.");
    const accepted = await openMls<NativeGroup>({ op: "acceptPending", context: this.context(conversationId, device, sync), state: state.value.state, commit: state.value.pending.commit });
    await this.save(conversationId, nativeGroup(state, accepted), cursor);
  }

  /** Reconcile the actual cryptographic leaves, including erased old leaves. */
  private async reconcile(conversationId: string, device: DeviceRecord, sync: SyncResult): Promise<boolean> {
    if (!sync.supportsOpenMlsRefresh || sync.deliveryFenceVersion !== 1) return false;
    const loaded = await this.load(conversationId, sync.directory);
    let state = loaded.state;
    const cursor = loaded.cursor;
    const context = this.context(conversationId, device, sync);
    const authority = await deliveryAuthority(conversationId, sync);
    if (state?.kind === "legacy") {
      if (!sync.inGroup || epochOf(state) !== sync.epoch) return false;
      const migrated = await openMls<NativeGroup>({ op: "migrate", context: this.context(conversationId, device, sync, membersOf(state)), groupInfo: await migrationInfo(state.value) });
      const request: CommitInput = { conversationId, deviceId: device.deviceId, create: false, refresh: true, fromEpoch: sync.epoch, authority, commit: migrated.pending!.commit, added: [], removed: [] };
      const pending: Group = { kind: "openmls", value: migrated, backup: b64(saveLegacy(state.value)), request };
      await this.save(conversationId, pending, cursor);
      await this.deliverPending(conversationId, device, pending, cursor, sync);
      return true;
    }
    const create = sync.epoch === null;
    if (create) state = { kind: "openmls", value: await openMls<NativeGroup>({ op: "create", context }) };
    if (!state || state.kind !== "openmls" || (!create && !sync.inGroup) || state.value.pending) return false;
    if (state.value.epoch !== (sync.epoch ?? 0)) return false;
    const actual = membersOf(state);
    const add = sync.entitled.map((d) => d.deviceId).filter((id) => !actual.includes(id));
    const entitled = new Set(sync.entitled.map((d) => d.deviceId));
    const remove = actual.filter((id) => !entitled.has(id));
    if (!add.length && !remove.length) return false;
    const claimed = add.length ? (await this.transport.claim({ conversationId, deviceId: device.deviceId, devices: add })).packages : [];
    const changed = await openMls<NativeGroup>({ op: "commit", context, state: state.value.state, add: claimed.map((c) => c.keyPackage), remove });
    const request: CommitInput = { conversationId, deviceId: device.deviceId, create, fromEpoch: changed.pending!.fromEpoch, authority, commit: changed.pending!.commit, ...(changed.pending!.welcome ? { welcome: changed.pending!.welcome } : {}), added: claimed.map((c) => ({ deviceId: c.deviceId, keyPackageId: c.keyPackageId })), removed: remove };
    const pending: Group = { ...nativeGroup(state, changed), request };
    await this.save(conversationId, pending, cursor);
    await this.deliverPending(conversationId, device, pending, cursor, sync);
    return true;
  }

  private async sendControl(conversationId: string, device: DeviceRecord, callId: string, generation: number, key: string, fresh: boolean) {
    const sync = await this.transport.sync({ conversationId, deviceId: device.deviceId, after: Number.MAX_SAFE_INTEGER });
    const { state, cursor } = await this.load(conversationId, sync.directory);
    if (!state || state.kind !== "openmls" || !this.ready(state, sync)) throw conflict();
    this.assertOutgoingRoom(state);
    // A separately confirmed winning key can still reach a newly admitted
    // device while an older, different candidate remains uncertain. Never
    // replace/rebroadcast an uncertain candidate's own key automatically.
    if (state.outgoing?.some(sent => sent.kind === "control" && sent.callId === callId && sent.generation === generation && (fresh || sent.key === key))) throw Object.assign(new Error("The previous call-key delivery is still unconfirmed."), { code: "not_ready" });
    if (!fresh && await this.store.callKey(keySlot(callId, generation)) !== key) throw conflict();
    const authority = await deliveryAuthority(conversationId, sync);
    const encrypted = await openMls<NativeGroup>({ op: "encrypt", context: this.context(conversationId, device, sync), state: state.value.state, message: b64(await sealCallKey(conversationId, callId, generation, key, device)) });
    const candidate: Outgoing = { kind: "control", conversationId, deviceId: device.deviceId, epoch: state.value.epoch, ciphertext: encrypted.message!, callId, generation, key };
    if (!validOutgoing(candidate, conversationId, this.userId)) throw Object.assign(new Error("The encrypted call key exceeds its delivery bounds."), { code: "validation" });
    await this.save(conversationId, { ...nativeGroup(state, encrypted), outgoing: [...(state.outgoing ?? []), candidate] }, cursor);
    try {
      await this.transport.sendCallKey({ conversationId, deviceId: device.deviceId, epoch: candidate.epoch, authority, callId, generation, fresh, ciphertext: candidate.ciphertext });
      await this.settleOutgoing(conversationId, device, candidate);
    } catch (error) {
      if (EXPLICIT_REFUSALS.has(codeOf(error) ?? "")) await this.settleOutgoing(conversationId, device, candidate, undefined, true);
      throw error;
    }
  }

  /**
   * Keep every running call's current key with every device that should
   * have it: send it again to devices that joined since, and when the call
   * moved to a new generation (someone left, C12.37), a device that held the
   * previous key makes the new one. The server takes the first and refuses
   * the rest, so all devices end up on one key.
   */
  private async tendCallKeys(conversationId: string, device: DeviceRecord, calls: SyncResult["calls"]) {
    for (const call of calls) {
      if (!call.needsKey) continue;
      const persisted = await this.load(conversationId, []);
      const tolerate = (error: unknown) => { if (codeOf(error) !== "conflict") throw error; };
      const current = await this.store.callKey(keySlot(call.callId, call.generation));
      if (persisted.state?.kind === "openmls" && persisted.state.outgoing?.some(sent => sent.kind === "control" && sent.callId === call.callId && sent.generation === call.generation && (!current || sent.key === current))) continue;
      if (current) {
        await this.sendControl(conversationId, device, call.callId, call.generation, current, false).catch(tolerate);
        continue;
      }
      let heldBefore = false;
      for (let g = call.generation - 1; g >= 0 && !heldBefore; g--) heldBefore = Boolean(await this.store.callKey(keySlot(call.callId, g)));
      if (!heldBefore) continue;
      const key = b64(crypto.getRandomValues(new Uint8Array(32)));
      try {
        await this.sendControl(conversationId, device, call.callId, call.generation, key, true);
        await this.store.saveCallKey(keySlot(call.callId, call.generation), key);
      } catch (error) {
        tolerate(error);
      }
    }
  }

  /**
   * C12.24: make a fresh media key for a call and send it to everyone's
   * devices in the conversation. Returns the key for this device's own use.
   */
  async startCallKey(conversationId: string, callId: string): Promise<string> {
    const existing = await this.store.callKey(callId);
    if (existing) return existing;
    const device = await this.device();
    const key = b64(crypto.getRandomValues(new Uint8Array(32)));
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const status = await this.sync(conversationId);
      if (!status.ready) {
        if (attempt < RETRIES - 1) continue;
        throw Object.assign(new Error("This device has not been added to the conversation yet."), { code: "not_ready" });
      }
      const confirmed = await this.store.callKey(callId);
      if (confirmed) return confirmed;
      try {
        await this.serial(conversationId, () => this.sendControl(conversationId, device, callId, 0, key, true));
        await this.store.saveCallKey(callId, key);
        return key;
      } catch (error) {
        if (codeOf(error) !== "conflict") throw error;
      }
    }
    throw Object.assign(new Error("The conversation kept changing; try again."), { code: "conflict" });
  }

  /** C12.24/37: the call's current key generation, and its key once a device in the call has sent it here. */
  async currentCallKey(conversationId: string, callId: string): Promise<{ generation: number; key: string | null }> {
    const status = await this.sync(conversationId);
    const generation = status.calls.find((c) => c.callId === callId)?.generation ?? 0;
    return { generation, key: await this.store.callKey(keySlot(callId, generation)) };
  }

  async callKey(conversationId: string, callId: string): Promise<string | null> {
    return (await this.currentCallKey(conversationId, callId)).key;
  }

  /**
   * C12.35: who is really in this conversation's group, read from this
   * device's own MLS tree — not from what the server says — with a safety
   * number two people can compare. The number is the same on every device
   * of every person iff they all see the same set of devices and keys, so a
   * device added without someone's knowledge changes it for everyone.
   * `changed` lists devices that came or went since this member last
   * confirmed what they saw.
   */
  async verification(conversationId: string): Promise<Verification | null> {
    await this.sync(conversationId);
    const { state } = await this.load(conversationId, []);
    if (!state) return null;
    const devices: VerifiedDevice[] = [];
    for (const leaf of devicesOf(state)) devices.push({ ...leaf, fingerprint: "" });
    devices.sort((a, b) => (a.userId + a.deviceId).localeCompare(b.userId + b.deviceId));
    const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text) as BufferSource));
    for (const d of devices) d.fingerprint = await deviceCode(d.userId, d.deviceId, d.signatureKey);
    const number = digitGroups(await digest(`freeholder:safety:v1\n${conversationId}\n${devices.map((d) => `${d.userId}:${d.deviceId}:${d.signatureKey}`).join("\n")}`), 12);
    const current = devices.map((d) => `${d.userId}:${d.deviceId}`);
    const seen = await this.store.seenDevices(conversationId);
    if (!seen) await this.store.saveSeenDevices(conversationId, current);
    const before = new Set(seen ?? current);
    const now = new Set(current);
    return {
      number,
      devices,
      changed: { added: current.filter((d) => !before.has(d)), removed: [...before].filter((d) => !now.has(d)) },
    };
  }

  /** C12.35: the member has looked at the devices and accepts them as they are. */
  async confirmDevices(conversationId: string): Promise<void> {
    const v = await this.verification(conversationId);
    if (v) await this.store.saveSeenDevices(conversationId, v.devices.map((d) => `${d.userId}:${d.deviceId}`));
  }

  /** C12.34/35: this device's own code, shown so the member can match it on another device. */
  async code(): Promise<string> {
    const device = await this.device();
    return deviceCode(this.userId, device.deviceId, b64(device.publicKey));
  }

  /** C12.34: ask the member's other devices for earlier history. Returns this device's code. */
  async askForHistory(): Promise<string> {
    return this.serial("history", async () => {
      const device = await this.device();
      const pair = await openMls<{ publicKey: string; privateKey: string }>({ op: "generateHpkeKeys" });
      const publicKey = pair.publicKey;
      await this.store.saveHistoryKey(unb64(pair.privateKey));
      const sig = b64(await sign(device.signKey, historyStatement(this.userId, device.deviceId, publicKey)));
      await this.transport.requestHistory({ deviceId: device.deviceId, publicKey, sig });
      return this.code();
    });
  }

  /** C12.34: requests from the member's other devices, each checked against that device's own key. */
  async historyAsks(): Promise<HistoryAsk[]> {
    const device = await this.device();
    const { requests } = await this.transport.historyRequests({ deviceId: device.deviceId });
    const asks: HistoryAsk[] = [];
    for (const r of requests) {
      const ok = await verify(unb64(r.signatureKey), historyStatement(this.userId, r.deviceId, r.publicKey), unb64(r.sig)).catch(() => false);
      if (ok) asks.push({ id: r.id, label: r.label, code: await deviceCode(this.userId, r.deviceId, r.signatureKey), publicKey: r.publicKey });
    }
    return asks;
  }

  /** C12.34: the member approved: seal every conversation this device has read to the asking device. */
  async giveHistory(ask: HistoryAsk): Promise<number> {
    return this.serial("history", async () => {
      const device = await this.device();

      let sent = 0;
      for (const conversationId of await this.store.conversations()) {
        // Up to date first, so the new device gets everything this one can read.
        await this.sync(conversationId).catch(() => undefined);
        const entries = [...(await this.store.messages(conversationId))].filter(([, m]) => m.ok);
        let chunk: [string, ReadMessage][] = [];
        let size = 0;
        const flush = async () => {
          if (!chunk.length) return;
          const plaintext = utf8(JSON.stringify({ v: 1, conversationId, messages: chunk }));
          const sealed = await openMls<{ enc: string; ciphertext: string }>({ op: "sealHistory", publicKey: ask.publicKey, message: b64(plaintext), info: b64(HISTORY_INFO), aad: b64(utf8(`${ask.id}\n${conversationId}`)) });
          await this.transport.sendHistory({ requestId: ask.id, deviceId: device.deviceId, conversationId, enc: sealed.enc, ct: sealed.ciphertext });
          sent += chunk.length;
          chunk = [];
          size = 0;
        };
        try {
          for (const entry of entries) {
            const bytes = JSON.stringify(entry).length;
            if (size + bytes > HISTORY_CHUNK_BYTES) await flush();
            chunk.push(entry);
            size += bytes;
          }
          await flush();
        } catch (error) {
          // A conversation the member has since left is skipped, not fatal.
          if (codeOf(error) !== "not_found") throw error;
        }
      }
      await this.transport.closeHistory({ requestId: ask.id });
      return sent;
    });
  }

  /** C12.34: open history sealed to this device and keep what it did not already have. */
  async takeHistory(): Promise<number> {
    return this.serial("history", async () => {
      const key = await this.store.historyKey();
      if (!key) return 0;
      const device = await this.device();

      const { transfers } = await this.transport.receivedHistory({ deviceId: device.deviceId });
      let kept = 0;
      const done: string[] = [];
      for (const t of transfers) {
        try {
          const opened = await openMls<{ message: string }>({ op: "openHistory", privateKey: b64(key), enc: t.enc, ciphertext: t.ct, info: b64(HISTORY_INFO), aad: b64(utf8(`${t.requestId}\n${t.conversationId}`)) });
          const plain = unb64(opened.message);
          const bundle = JSON.parse(new TextDecoder().decode(plain)) as { v: number; conversationId: string; messages: [string, ReadMessage][] };
          if (bundle.v === 1 && bundle.conversationId === t.conversationId) {
            await this.serial(t.conversationId, async () => {
              const have = await this.store.messages(t.conversationId);
              for (const [id, message] of bundle.messages) {
                if (have.get(id)?.ok) continue;
                await this.store.saveMessage(t.conversationId, id, message);
                kept++;
              }
            });
          }
        } catch {
          // Something that does not open with this device's key is dropped.
        }
        done.push(t.id);
      }
      if (done.length) await this.transport.ackHistory({ deviceId: device.deviceId, ids: done });
      return kept;
    });
  }

  /** Encrypt and send. Returns the message id, or null if the conversation cannot be encrypted. */
  async send(conversationId: string, body: string, attachments: { assetId: string; altText: string }[] = [], files: SealedFile[] = []): Promise<string | null> {
    const device = await this.device();
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const status = await this.sync(conversationId);
      if (!status.available) return null;
      if (!status.ready) {
        if (attempt < RETRIES - 1) continue;
        throw Object.assign(new Error("This device has not been added to the conversation yet."), { code: "not_ready" });
      }
      try {
        return await this.serial(conversationId, async () => {
          const fresh = await this.transport.sync({ conversationId, deviceId: device.deviceId, after: Number.MAX_SAFE_INTEGER });
          const { state, cursor } = await this.load(conversationId, fresh.directory);
          if (!state || state.kind !== "openmls" || !this.ready(state, fresh)) throw conflict();
          this.assertOutgoingRoom(state);
          const authority = await deliveryAuthority(conversationId, fresh);
          const sealed = await sealPayload(conversationId, body, device, files);
          const message = await openMls<NativeGroup>({ op: "encrypt", context: this.context(conversationId, device, fresh), state: state.value.state, message: b64(sealed.bytes) });
          const tag = await frankTag(unb64(sealed.fk), conversationId, this.userId, body);
          const candidate: Outgoing = { kind: "application", conversationId, deviceId: device.deviceId, epoch: state.value.epoch, ciphertext: message.message!, frankTag: tag, read: { body, fk: sealed.fk, senderUserId: this.userId, ok: true, ...(files.length ? { files } : {}) } };
          if (!validOutgoing(candidate, conversationId, this.userId)) throw Object.assign(new Error("The encrypted message exceeds its delivery bounds."), { code: "validation" });
          // Persist ratchet AND local recovery content before transport. Unknown
          // outcomes are retained; catching up never retransmits them blindly.
          await this.save(conversationId, { ...nativeGroup(state, message), outgoing: [...(state.outgoing ?? []), candidate] }, cursor);
          try {
            const { id } = await this.transport.send({ conversationId, deviceId: device.deviceId, epoch: candidate.epoch, authority, ciphertext: candidate.ciphertext, frankTag: tag, attachments, sealedFiles: files.map(file => file.blob) });
            await this.settleOutgoing(conversationId, device, candidate, id);
            return id;
          } catch (error) {
            if (EXPLICIT_REFUSALS.has(codeOf(error) ?? "")) await this.settleOutgoing(conversationId, device, candidate, undefined, true);
            throw error;
          }
        });
      } catch (error) {
        if (codeOf(error) !== "conflict") throw error;
      }
    }
    throw Object.assign(new Error("The conversation kept changing; try again."), { code: "conflict" });
  }
}
