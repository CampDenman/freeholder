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
import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  joinGroup,
  processPrivateMessage,
  type ClientState,
  type Credential,
  type PrivateKeyPackage,
} from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { b64, frankTag, identityOf, openCallKey, openPayload, parseIdentity, sameTag, sealCallKey, sealPayload, suite, unb64, utf8 } from "./wire";

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
  privatePackage: PrivateKeyPackage;
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
  commit(input: { conversationId: string; deviceId: string; create: boolean; fromEpoch: number; commit: string; welcome?: string; added: { deviceId: string; keyPackageId: string }[]; removed: string[] }): Promise<{ epoch: number }>;
  send(input: { conversationId: string; deviceId: string; epoch: number; ciphertext: string; frankTag: string; attachments: { assetId: string; altText: string }[] }): Promise<{ id: string }>;
  sendCallKey(input: { conversationId: string; deviceId: string; epoch: number; callId: string; generation: number; fresh: boolean; ciphertext: string }): Promise<unknown>;
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

/** Five-digit groups from a digest, as in other messengers' safety numbers. */
function groups(bytes: Uint8Array, count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = ((bytes[(i * 2) % bytes.length]! << 16) | (bytes[(i * 2 + 1) % bytes.length]! << 8) | bytes[(i * 2 + 2) % bytes.length]!) % 100000;
    out.push(String(n).padStart(5, "0"));
  }
  return out.join(" ");
}

/** Where a call's key for one generation is kept on the device. */
const keySlot = (callId: string, generation: number) => (generation === 0 ? callId : `${callId}#${generation}`);

const codeOf = (error: unknown): string | undefined => (error && typeof error === "object" && "code" in error ? String(error.code) : undefined);

export class E2eeDevice {
  private queue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly userId: string,
    private readonly store: E2eeStore,
    private readonly transport: E2eeTransport,
    private readonly label: string,
  ) {}

  /** One operation at a time per conversation: group state moves strictly forward. */
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queue.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queue.set(key, next);
    return next;
  }

  private async newKeyPackages(device: DeviceRecord, count: number, lastResort = false): Promise<StoredKeyPackage[]> {
    const cs = await suite();
    const credential: Credential = { credentialType: "basic", identity: utf8(identityOf(device.userId, device.deviceId)) };
    const made: StoredKeyPackage[] = [];
    for (let i = 0; i < count; i++) {
      const kp = await generateKeyPackageWithKey(credential, defaultCapabilities(), defaultLifetime, [], { signKey: device.signKey, publicKey: device.publicKey }, cs);
      const publicPackage = b64(encodeMlsMessage({ keyPackage: kp.publicPackage, wireformat: "mls_key_package", version: "mls10" }));
      made.push({ id: crypto.randomUUID(), publicPackage, privatePackage: kp.privatePackage, lastResort });
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
        const keys = await (await suite()).signature.keygen();
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

  private config(directory: DeviceEntry[]) {
    const keys = new Map(directory.map((d) => [d.deviceId, d]));
    return {
      ...defaultClientConfig,
      authService: {
        // Only a device the directory vouches for, carrying exactly the key it published.
        async validateCredential(credential: Credential, signaturePublicKey: Uint8Array): Promise<boolean> {
          if (credential.credentialType !== "basic") return false;
          const who = parseIdentity(credential.identity);
          const known = who ? keys.get(who.deviceId) : undefined;
          return Boolean(known && known.userId === who!.userId && known.signatureKey === b64(signaturePublicKey));
        },
      },
    };
  }

  private async load(conversationId: string, directory: DeviceEntry[]): Promise<{ state: ClientState | null; cursor: number }> {
    const saved = await this.store.group(conversationId);
    if (!saved?.state) return { state: null, cursor: saved?.cursor ?? 0 };
    const decoded = decodeGroupState(saved.state, 0);
    if (!decoded) return { state: null, cursor: saved.cursor };
    return { state: { ...decoded[0], clientConfig: this.config(directory) }, cursor: saved.cursor };
  }

  private async save(conversationId: string, state: ClientState | null, cursor: number) {
    await this.store.saveGroup(conversationId, state ? encodeGroupState(state) : null, cursor);
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
      if (result?.available) await this.tendCallKeys(conversationId, device, result.calls);
      const { state } = await this.load(conversationId, result?.directory ?? []);
      const fresh = result ? await this.transport.sync({ conversationId, deviceId: device.deviceId, after: Number.MAX_SAFE_INTEGER }) : null;
      return {
        available: fresh?.available ?? false,
        ready: Boolean(state && fresh?.inGroup),
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
    const cs = await suite();
    let result: SyncResult;
    let { state, cursor } = await this.load(conversationId, []);
    do {
      result = await this.transport.sync({ conversationId, deviceId: device.deviceId, after: cursor });
      const config = this.config(result.directory);
      if (state) state = { ...state, clientConfig: config };
      const keys = new Map(result.directory.map((d) => [d.deviceId, d]));
      for (const entry of result.log) {
        cursor = entry.seq;
        if (entry.senderDeviceId === device.deviceId && entry.kind !== "welcome") {
          await this.save(conversationId, state, cursor);
          continue;
        }
        const decoded = decodeMlsMessage(unb64(entry.payload), 0)?.[0];
        try {
          if (entry.kind === "welcome") {
            const kp = entry.keyPackageId ? await this.store.keyPackage(entry.keyPackageId) : null;
            const welcome = decoded?.wireformat === "mls_welcome" ? decoded.welcome : null;
            const published = kp ? decodeMlsMessage(unb64(kp.publicPackage), 0)?.[0] : undefined;
            if (kp && welcome && published?.wireformat === "mls_key_package") {
              state = await joinGroup(welcome, published.keyPackage, kp.privatePackage, emptyPskIndex, cs, undefined, undefined, config);
              if (!kp.lastResort) await this.store.dropKeyPackage(kp.id);
            }
          } else if (state && decoded?.wireformat === "mls_private_message") {
            const processed = await processPrivateMessage(state, decoded.privateMessage, emptyPskIndex, cs);
            state = processed.newState;
            if (state.groupActiveState.kind === "removedFromGroup") state = null;
            if (processed.kind === "applicationMessage" && entry.kind === "control" && entry.callId) {
              const sender = entry.senderDeviceId ? keys.get(entry.senderDeviceId) : undefined;
              const generation = entry.callGeneration ?? 0;
              const key = sender ? await openCallKey(conversationId, entry.callId, generation, processed.message, { deviceId: sender.deviceId, signatureKey: unb64(sender.signatureKey) }) : null;
              if (key) await this.store.saveCallKey(keySlot(entry.callId, generation), key);
            } else if (processed.kind === "applicationMessage" && entry.messageId) {
              const sender = entry.senderDeviceId ? keys.get(entry.senderDeviceId) : undefined;
              const payload = sender ? await openPayload(conversationId, processed.message, { deviceId: sender.deviceId, signatureKey: unb64(sender.signatureKey) }) : null;
              const matches = Boolean(payload && sender && entry.frankTag && sameTag(await frankTag(unb64(payload.fk), conversationId, sender.userId, payload.body), entry.frankTag));
              await this.store.saveMessage(conversationId, entry.messageId, matches ? { body: payload!.body, fk: payload!.fk, senderUserId: sender!.userId, ok: true } : { body: "", fk: "", senderUserId: sender?.userId ?? "", ok: false });
            }
          }
        } catch {
          // A message this device cannot open (sent before it joined, or
          // malformed) is shown as unreadable; the log moves on.
          if (entry.kind === "application" && entry.messageId) await this.store.saveMessage(conversationId, entry.messageId, { body: "", fk: "", senderUserId: "", ok: false });
        }
        await this.save(conversationId, state, cursor);
      }
    } while (result.more);
    return result;
  }

  /** Make the group hold exactly the entitled devices. True when it committed a change. */
  private async reconcile(conversationId: string, device: DeviceRecord, sync: SyncResult): Promise<boolean> {
    const cs = await suite();
    const { state, cursor } = await this.load(conversationId, sync.directory);
    const entitled = new Set(sync.entitled.map((d) => d.deviceId));
    if (sync.epoch === null) {
      // Nobody has made the group yet: this device does, with everyone in it.
      const others = sync.entitled.filter((d) => d.deviceId !== device.deviceId).map((d) => d.deviceId);
      if (!others.length) return false;
      const [own] = await this.newKeyPackages(device, 1);
      const ownPackage = decodeMlsMessage(unb64(own!.publicPackage), 0)![0];
      if (ownPackage.wireformat !== "mls_key_package") return false;
      const created = await createGroup(utf8(conversationId), ownPackage.keyPackage, own!.privatePackage, [], cs, this.config(sync.directory));
      return this.change(conversationId, device, created, cursor, true, others, []);
    }
    if (!sync.inGroup || !state) return false;
    const add = sync.entitled.map((d) => d.deviceId).filter((id) => !sync.roster.includes(id));
    const remove = sync.roster.filter((id) => !entitled.has(id));
    if (!add.length && !remove.length) return false;
    return this.change(conversationId, device, state, cursor, false, add, remove);
  }

  private async change(conversationId: string, device: DeviceRecord, state: ClientState, cursor: number, create: boolean, add: string[], remove: string[]): Promise<boolean> {
    const cs = await suite();
    const claimed = add.length ? (await this.transport.claim({ conversationId, deviceId: device.deviceId, devices: add })).packages : [];
    const proposals = [];
    for (const c of claimed) {
      const decoded = decodeMlsMessage(unb64(c.keyPackage), 0)?.[0];
      if (decoded?.wireformat !== "mls_key_package") throw new Error("A key package could not be read.");
      proposals.push({ proposalType: "add" as const, add: { keyPackage: decoded.keyPackage } });
    }
    for (const id of remove) {
      const leaf = state.ratchetTree.findIndex((n) => n?.nodeType === "leaf" && parseIdentity((n.leaf.credential as { identity: Uint8Array }).identity)?.deviceId === id);
      if (leaf >= 0) proposals.push({ proposalType: "remove" as const, remove: { removed: leaf / 2 } });
    }
    const result = await createCommit({ state, cipherSuite: cs }, { extraProposals: proposals, ratchetTreeExtension: true });
    await this.transport.commit({
      conversationId,
      deviceId: device.deviceId,
      create,
      fromEpoch: Number(state.groupContext.epoch),
      commit: b64(encodeMlsMessage(result.commit)),
      welcome: result.welcome ? b64(encodeMlsMessage({ welcome: result.welcome, wireformat: "mls_welcome", version: "mls10" })) : undefined,
      added: claimed.map((c) => ({ deviceId: c.deviceId, keyPackageId: c.keyPackageId })),
      removed: remove,
    });
    // Only an accepted commit moves this device to the next epoch.
    await this.save(conversationId, result.newState, cursor);
    return true;
  }

  private async sendControl(conversationId: string, device: DeviceRecord, callId: string, generation: number, key: string, fresh: boolean) {
    const cs = await suite();
    const { state, cursor } = await this.load(conversationId, []);
    if (!state) throw Object.assign(new Error("not ready"), { code: "conflict" });
    const message = await createApplicationMessage(state, await sealCallKey(conversationId, callId, generation, key, device), cs);
    await this.save(conversationId, message.newState, cursor);
    await this.transport.sendCallKey({
      conversationId,
      deviceId: device.deviceId,
      epoch: Number(state.groupContext.epoch),
      callId,
      generation,
      fresh,
      ciphertext: b64(encodeMlsMessage({ privateMessage: message.privateMessage, wireformat: "mls_private_message", version: "mls10" })),
    });
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
      const tolerate = (error: unknown) => { if (codeOf(error) !== "conflict") throw error; };
      const current = await this.store.callKey(keySlot(call.callId, call.generation));
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
      if (!status.ready) throw Object.assign(new Error("This device has not been added to the conversation yet."), { code: "not_ready" });
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
    for (const node of state.ratchetTree) {
      if (node?.nodeType !== "leaf" || node.leaf.credential.credentialType !== "basic") continue;
      const who = parseIdentity(node.leaf.credential.identity);
      if (!who) continue;
      devices.push({ userId: who.userId, deviceId: who.deviceId, signatureKey: b64(node.leaf.signaturePublicKey), fingerprint: "" });
    }
    devices.sort((a, b) => (a.userId + a.deviceId).localeCompare(b.userId + b.deviceId));
    const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text) as BufferSource));
    for (const d of devices) d.fingerprint = groups(await digest(`freeholder:device:v1\n${d.userId}\n${d.deviceId}\n${d.signatureKey}`), 4);
    const number = groups(await digest(`freeholder:safety:v1\n${conversationId}\n${devices.map((d) => `${d.userId}:${d.deviceId}:${d.signatureKey}`).join("\n")}`), 12);
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

  /** Encrypt and send. Returns the message id, or null if the conversation cannot be encrypted. */
  async send(conversationId: string, body: string, attachments: { assetId: string; altText: string }[] = []): Promise<string | null> {
    const device = await this.device();
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const status = await this.sync(conversationId);
      if (!status.available) return null;
      if (!status.ready) throw Object.assign(new Error("This device has not been added to the conversation yet."), { code: "not_ready" });
      try {
        return await this.serial(conversationId, async () => {
          const cs = await suite();
          const { state, cursor } = await this.load(conversationId, []);
          if (!state) throw Object.assign(new Error("not ready"), { code: "conflict" });
          const sealed = await sealPayload(conversationId, body, device);
          const message = await createApplicationMessage(state, sealed.bytes, cs);
          // The ratchet moves forward before anything leaves the device, so a
          // key is never used twice even if the server refuses this message.
          await this.save(conversationId, message.newState, cursor);
          const { id } = await this.transport.send({
            conversationId,
            deviceId: device.deviceId,
            epoch: Number(state.groupContext.epoch),
            ciphertext: b64(encodeMlsMessage({ privateMessage: message.privateMessage, wireformat: "mls_private_message", version: "mls10" })),
            frankTag: await frankTag(unb64(sealed.fk), conversationId, this.userId, body),
            attachments,
          });
          await this.store.saveMessage(conversationId, id, { body, fk: sealed.fk, senderUserId: this.userId, ok: true });
          return id;
        });
      } catch (error) {
        if (codeOf(error) !== "conflict") throw error;
      }
    }
    throw Object.assign(new Error("The conversation kept changing; try again."), { code: "conflict" });
  }
}
