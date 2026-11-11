// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: end-to-end encrypted member messages. Real MLS devices (the same
// engine browsers run, with memory stores) talk through the real services;
// the database is then searched for anything readable.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { followMember } from "@/modules/members/graph";
import { leaveConversation, sendMessage, startConversation, unsendMessage, viewConversation } from "@/modules/members/messages";
import { reportContent } from "@/modules/members/reports";
import { claimKeyPackages, e2eeSync, registerDevice, revokeDevice, sendEncrypted } from "@/modules/members/e2ee/service";
import { E2eeDevice, MAX_UNCONFIRMED_OUTGOING, type E2eeStore } from "@/modules/members/e2ee/engine";
import { startGroupCall } from "@/modules/members/group-calls";
import { setSfuForTests } from "@/modules/members/sfu";
import { deviceFor, memoryStore, directTransport } from "../helpers/e2ee";
import { LegacyE2eeDevice } from "../helpers/legacy-e2ee";
import { memberKeyPackages, memberReports, memberSealedBlobs, memberConversations, memberProfiles } from "@/modules/members/schema";
import { purgeSealedBlobs, sealedBlobAccess, uploadSealedBlob } from "@/modules/members/sealed-blobs";
import { openFile, sealFile, b64, utf8 } from "@/modules/members/e2ee/wire";
import { openMls } from "@/modules/members/e2ee/crypto";
import { deliveryAuthority } from "@/modules/members/e2ee/authority";
import { storage } from "@/adapters/storage";
import { requestHistory } from "@/modules/members/e2ee/history";
import { memberHistoryTransfers } from "@/modules/members/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

type Member = typeof CUSTOMER;
const RAE = CUSTOMER;
const SAM: Member = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM: Member = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };

const bodies = async (device: E2eeDevice, id: string) => [...(await device.sync(id)).messages.values()].map((m) => (m.ok ? m.body : "(unreadable)"));

describe.runIf(hasDatabase)("end-to-end encrypted messages (C12.23)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
      { id: KIM.userId, email: "kim@example.test", role: "customer" },
    ]);
    for (const [actor, handle, name] of [[RAE, "rae", "Rae"], [SAM, "sam", "Sam"], [KIM, "kim", "Kim"]] as const) {
      await joinSite.call({ handle, displayName: name, meetsMinimumAge: true, isAdult: true }, actor);
      await updateMyMembership.call({ isPrivate: false }, actor);
    }
    await followMember.call({ handle: "rae" }, SAM);
    await followMember.call({ handle: "sam" }, RAE);
  });
  afterAll(closeDb);

  it("encrypts between every device, keeps nothing readable on the server, and franks reports", { timeout: 60_000 }, async () => {
    const rae = deviceFor(RAE, "Rae laptop");
    const sam = deviceFor(SAM, "Sam phone");
    const samTablet = deviceFor(SAM, "Sam tablet");
    await Promise.all([rae.device(), sam.device(), samTablet.device()]);

    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    // Everyone has a device, so plaintext is refused and the group is made on first send.
    expect((await failure(sendMessage.call({ conversationId: id, body: "plain" }, RAE))).code).toBe("validation");
    expect((await failure(startConversation.call({ handles: ["sam"], body: "plain" }, RAE))).code).toBe("validation");
    const first = await rae.send(id, "Meet at the north gate at 7");
    expect(first).toBeTruthy();
    expect(await bodies(sam, id)).toEqual(["Meet at the north gate at 7"]);
    expect(await bodies(samTablet, id)).toEqual(["Meet at the north gate at 7"]);
    await sam.send(id, "See you there");
    expect(await bodies(rae, id)).toEqual(["Meet at the north gate at 7", "See you there"]);
    expect(await bodies(samTablet, id)).toEqual(["Meet at the north gate at 7", "See you there"]);

    // The server's copy: flagged encrypted, no body, nothing readable anywhere.
    const view = await viewConversation.call({ id }, SAM);
    expect(view.conversation.e2ee).toBe(true);
    expect(view.messages.map((m) => [m.body, m.encrypted])).toEqual([[null, true], [null, true]]);
    const dump = JSON.stringify((await db().execute(sql`select * from member_messages`))) + JSON.stringify((await db().execute(sql`select * from member_mls_log`)));
    expect(dump).not.toContain("north gate");
    expect(dump).not.toContain(Buffer.from("north gate").toString("base64"));

    // A franked report reveals exactly that message; a doctored one is refused.
    const read = (await sam.sync(id)).messages.get(first!)!;
    expect((await failure(reportContent.call({ targetType: "message", targetId: first!, reason: "harassment" }, SAM))).code).toBe("validation");
    expect((await failure(reportContent.call({ targetType: "message", targetId: first!, reason: "harassment", franking: { body: "Something she never said", key: read.fk } }, SAM))).code).toBe("validation");
    await reportContent.call({ targetType: "message", targetId: first!, reason: "harassment", franking: { body: read.body, key: read.fk } }, SAM);
    expect((await db().select({ excerpt: memberReports.excerpt }).from(memberReports))).toEqual([{ excerpt: "Meet at the north gate at 7" }]);

    // Sam removes the tablet: it is taken out before anyone sends again, and cannot read what follows.
    const tabletId = (await samTablet.device()).deviceId;
    await revokeDevice.call({ deviceId: tabletId }, SAM);
    const deviceId = (await rae.device()).deviceId;
    const stale = await e2eeSync.call({ conversationId: id, deviceId, after: 0 }, RAE);
    expect((await failure(sendEncrypted.call({ conversationId: id, deviceId, epoch: stale.epoch!, authority: "0".repeat(64), ciphertext: "AAAA", frankTag: "A".repeat(43) + "=", attachments: [] }, RAE))).code).toBe("conflict");
    await rae.send(id, "Changed plans: south gate");
    expect(await bodies(sam, id)).toContain("Changed plans: south gate");
    await expect(samTablet.sync(id)).rejects.toThrow(/removed/);

    // A device Rae adds later reads from then on, not before (history is C12.34).
    const raePhone = deviceFor(RAE, "Rae phone");
    await raePhone.device();
    await sam.send(id, "Bring a torch");
    expect(await bodies(raePhone, id)).toEqual(["Bring a torch"]);

    // Unsending removes the ciphertext as well.
    await sam.send(id, "oops");
    const oops = [...(await sam.sync(id)).messages].find(([, m]) => m.body === "oops")![0];
    await unsendMessage.call({ id: oops }, SAM);
    const log = await db().execute(sql`select count(*)::int as n from member_mls_log where message_id = ${oops}`);
    expect(log[0]).toEqual({ n: 0 });
  });

  it("encrypts a group, drops people who leave, and labels only an agent's plaintext", { timeout: 60_000 }, async () => {
    await followMember.call({ handle: "rae" }, KIM);
    await followMember.call({ handle: "kim" }, RAE);
    const rae = deviceFor(RAE, "Rae");
    const sam = deviceFor(SAM, "Sam");
    const kim = deviceFor(KIM, "Kim");
    await Promise.all([rae.device(), sam.device(), kim.device()]);
    const { id } = await startConversation.call({ handles: ["sam", "kim"], title: "Trip" }, RAE);
    await rae.send(id, "Who's driving?");
    expect(await bodies(kim, id)).toEqual(["Who's driving?"]);
    await leaveConversation.call({ conversationId: id }, KIM);
    await sam.send(id, "I am");
    expect(await bodies(rae, id)).toEqual(["Who's driving?", "I am"]);
    await expect(kim.sync(id)).rejects.toThrow();

    // A member's own agent can never add a device that would read their messages.
    const agent = { ...RAE, keyScopes: ["members.registerDevice", "members.sendMessage"] };
    const kp = { id: crypto.randomUUID(), keyPackage: "AAAA" };
    expect((await failure(registerDevice.call({ deviceId: crypto.randomUUID(), label: "agent", signatureKey: "A".repeat(43) + "=", keyPackages: [kp], lastResort: kp }, agent))).code).toBe("permission");
    // It holds no device keys: its plaintext is accepted and marked as such.
    await sendMessage.call({ conversationId: id, body: "Reminder from Rae's assistant" }, agent);
    const view = await viewConversation.call({ id }, SAM);
    expect(view.messages.map((m) => [m.body, m.encrypted])).toEqual([[null, true], [null, true], ["Reminder from Rae's assistant", false]]);
  });

  it("shows everyone the same safety number, and a new device changes it visibly (C12.35)", { timeout: 60_000 }, async () => {
    const rae = deviceFor(RAE, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "hello");
    const first = (await rae.verification(id))!;
    expect(first.devices.map((d) => d.userId).sort()).toEqual([RAE.userId, SAM.userId].sort());
    expect(first.number).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect((await sam.verification(id))!.number).toBe(first.number);
    expect(first.changed).toEqual({ added: [], removed: [] });

    // A device joins Sam's account — as one the server added on its own would.
    const extra = deviceFor(SAM, "Unknown device");
    const extraId = (await extra.device()).deviceId;
    await rae.send(id, "who else is here?");
    const after = (await rae.verification(id))!;
    expect(after.number).not.toBe(first.number);
    expect((await sam.verification(id))!.number).toBe(after.number);
    expect(after.changed.added).toEqual([`${SAM.userId}:${extraId}`]);
    await rae.confirmDevices(id);
    expect((await rae.verification(id))!.changed).toEqual({ added: [], removed: [] });
  });

  it("encrypts files on the device, serves only ciphertext to people in the conversation, and purges them (C12.36)", { timeout: 60_000 }, async () => {
    const rae = deviceFor(RAE, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "first");
    const photo = new Uint8Array(4096).map((_, i) => (i * 7) % 251);
    const sealed = await sealFile(photo);
    const { id: blob } = await uploadSealedBlob.call({ conversationId: id, bytes: sealed.ciphertext }, RAE);
    const messageId = await rae.send(id, "the view from the top", [], [{ blob, key: sealed.key, iv: sealed.iv, name: "summit.jpg", type: "image/jpeg", size: photo.length, alt: "A ridge above the clouds" }]);

    // Sam's device gets the file's key inside the message, and the server holds only ciphertext.
    const read = (await sam.sync(id)).messages.get(messageId!)!;
    expect(read.files?.map((f) => [f.name, f.alt])).toEqual([["summit.jpg", "A ridge above the clouds"]]);
    const access = await sealedBlobAccess.call({ id: blob }, SAM);
    const stored = await storage().get(access!.storageKey);
    expect(Buffer.from(stored!).equals(Buffer.from(photo))).toBe(false);
    expect(Buffer.from(await openFile(stored!, read.files![0]!)).equals(Buffer.from(photo))).toBe(true);
    expect(await sealedBlobAccess.call({ id: blob }, KIM)).toBeNull();

    // A file can be attached once, by its uploader, and unsending stops serving it; the sweep deletes it.
    await expect(sam.send(id, "reusing it", [], [{ ...read.files![0]! }])).rejects.toThrow();
    await unsendMessage.call({ id: messageId! }, RAE);
    expect(await sealedBlobAccess.call({ id: blob }, SAM)).toBeNull();
    expect((await purgeSealedBlobs()).purged).toBe(1);
    expect(await storage().get(access!.storageKey)).toBeUndefined();
    expect(await db().select().from(memberSealedBlobs)).toEqual([]);
  });

  it("brings earlier messages to a new device only when the member approves it on another (C12.34)", { timeout: 60_000 }, async () => {
    const rae = deviceFor(RAE, "Rae");
    const sam = deviceFor(SAM, "Sam phone");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "The gate word is opal-lantern");
    await sam.send(id, "Thanks");
    const tablet = deviceFor(SAM, "Sam tablet");
    const tabletDevice = await tablet.device();
    await rae.send(id, "And bring snacks");
    expect((await bodies(tablet, id)).filter((b) => b !== "(unreadable)")).toEqual(["And bring snacks"]);

    // The tablet asks; Sam's phone sees the request with the tablet's own code; Rae never sees it.
    const shown = await tablet.askForHistory();
    expect(shown).toBe(await tablet.code());
    const [ask] = await sam.historyAsks();
    expect(ask?.code).toBe(shown);
    expect(await rae.historyAsks()).toEqual([]);
    expect((await failure(requestHistory.call({ deviceId: tabletDevice.deviceId, publicKey: "AAAA", sig: "A".repeat(86) + "==" }, SAM))).code).toBe("validation");

    // Nothing moves until the phone approves; then the tablet reads the earlier messages.
    expect(await tablet.takeHistory()).toBe(0);
    expect(await sam.giveHistory(ask!)).toBeGreaterThanOrEqual(3);
    const sealed = JSON.stringify(await db().select().from(memberHistoryTransfers));
    // A hyphenated word cannot occur by chance in base64 or hex ids.
    expect(sealed).not.toContain("opal-lantern");
    expect(await tablet.takeHistory()).toBe(2);
    expect(await bodies(tablet, id)).toEqual(expect.arrayContaining(["The gate word is opal-lantern", "Thanks", "And bring snacks"]));
    expect(await db().select().from(memberHistoryTransfers)).toEqual([]);
    expect(await sam.historyAsks()).toEqual([]);
  });

  it("hands a repeat claim the same key package instead of draining another member's (C11.10)", { timeout: 60_000 }, async () => {
    const rae = await deviceFor(RAE, "Rae").device();
    const sam = await deviceFor(SAM, "Sam").device();
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    const claim = () => claimKeyPackages.call({ conversationId: id, deviceId: rae.deviceId, devices: [sam.deviceId] }, RAE);
    const first = await claim();
    for (let i = 0; i < 5; i++) {
      expect((await claim()).packages[0]!.keyPackageId).toBe(first.packages[0]!.keyPackageId);
    }
    const claimed = await db().select().from(memberKeyPackages).where(eq(memberKeyPackages.claimedBy, rae.deviceId));
    expect(claimed).toHaveLength(1);
  });

  it("migrates existing identities and recovers the public commit skipped by an older client (C12.39)", { timeout: 90_000 }, async () => {
    const raeStore = memoryStore(), samStore = memoryStore();
    const old = (actor: Member, store: E2eeStore) => new LegacyE2eeDevice(actor.userId, store as unknown as ConstructorParameters<typeof LegacyE2eeDevice>[1], directTransport(actor), "Legacy device");
    const legacyRae = old(RAE, raeStore), legacySam = old(SAM, samStore);
    await Promise.all([legacyRae.device(), legacySam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await legacyRae.send(id, "Before the migration");
    await legacySam.sync(id);
    const before = (await legacyRae.verification(id))!;
    const rae = new E2eeDevice(RAE.userId, raeStore, directTransport(RAE), "Existing Rae");
    await rae.send(id, "After OpenMLS migration");
    // This is the actual old behavior: public commits were silently skipped.
    await legacySam.sync(id);
    const sam = new E2eeDevice(SAM.userId, samStore, directTransport(SAM), "Existing Sam");
    expect((await sam.sync(id)).ready).toBe(true);
    expect(await bodies(sam, id)).toEqual(["Before the migration", "After OpenMLS migration"]);
    expect((await sam.verification(id))!.number).toBe(before.number);
    expect((await rae.verification(id))!.devices.map((d) => [d.deviceId, d.signatureKey])).toEqual(before.devices.map((d) => [d.deviceId, d.signatureKey]));
    await sam.send(id, "Existing devices still reply");
    expect(await bodies(rae, id)).toContain("Existing devices still reply");
  });

  it("recovers an accepted creator commit after a lost response and serializes two clients on one store (C12.39)", { timeout: 60_000 }, async () => {
    const store = memoryStore();
    const transport = directTransport(RAE);
    let loseResponse = true;
    const rae = new E2eeDevice(RAE.userId, store, { ...transport, async commit(input) {
      const receipt = await transport.commit(input);
      if (loseResponse) { loseResponse = false; throw new Error("Synthetic lost commit response"); }
      return receipt;
    } }, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await expect(rae.send(id, "not delivered")).rejects.toThrow("Synthetic lost commit response");
    const recovered = new E2eeDevice(RAE.userId, store, transport, "Same device");
    expect((await recovered.sync(id)).ready).toBe(true);
    const otherTab = new E2eeDevice(RAE.userId, store, transport, "Same device second tab");
    await Promise.all([recovered.send(id, "First concurrent send"), otherTab.send(id, "Second concurrent send")]);
    expect(await bodies(sam, id)).toEqual(expect.arrayContaining(["First concurrent send", "Second concurrent send"]));
    expect((await db().execute(sql`select count(*)::int as n from member_mls_groups`))[0]).toEqual({ n: 1 });
  });

  it("recovers competing external migrations from their persisted legacy backups (C12.39)", { timeout: 90_000 }, async () => {
    const raeStore = memoryStore(), samStore = memoryStore();
    const raeTransport = directTransport(RAE), samTransport = directTransport(SAM);
    const oldRae = new LegacyE2eeDevice(RAE.userId, raeStore as unknown as ConstructorParameters<typeof LegacyE2eeDevice>[1], raeTransport, "Legacy Rae");
    const oldSam = new LegacyE2eeDevice(SAM.userId, samStore as unknown as ConstructorParameters<typeof LegacyE2eeDevice>[1], samTransport, "Legacy Sam");
    await Promise.all([oldRae.device(), oldSam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await oldRae.send(id, "Before competing migrations");
    await oldSam.sync(id);
    let prepared = 0;
    let release!: () => void;
    const bothPrepared = new Promise<void>((resolve) => { release = resolve; });
    const racing = (transport: ReturnType<typeof directTransport>) => ({ ...transport, async commit(input: Parameters<typeof transport.commit>[0]) {
      if (input.refresh && input.fromEpoch === 1) { if (++prepared === 2) release(); await bothPrepared; }
      return transport.commit(input);
    } });
    const rae = new E2eeDevice(RAE.userId, raeStore, racing(raeTransport), "Existing Rae");
    const sam = new E2eeDevice(SAM.userId, samStore, racing(samTransport), "Existing Sam");
    await Promise.all([rae.sync(id), sam.sync(id)]);
    expect(prepared).toBe(2);
    await rae.send(id, "After competing migrations");
    expect(await bodies(sam, id)).toEqual(["Before competing migrations", "After competing migrations"]);
    expect((await sam.verification(id))!.number).toBe((await rae.verification(id))!.number);
  });

  it("abandons a losing member commit without rewinding the sender ratchet (C12.39)", { timeout: 90_000 }, async () => {
    const raeStore = memoryStore(), samStore = memoryStore();
    const raeTransport = directTransport(RAE), samTransport = directTransport(SAM);
    let prepared = 0;
    let release!: () => void;
    const bothPrepared = new Promise<void>((resolve) => { release = resolve; });
    const racing = (transport: ReturnType<typeof directTransport>) => ({ ...transport, async commit(input: Parameters<typeof transport.commit>[0]) {
      if (!input.create && input.added.length && input.fromEpoch === 1) { if (++prepared === 2) release(); await bothPrepared; }
      return transport.commit(input);
    } });
    const rae = new E2eeDevice(RAE.userId, raeStore, racing(raeTransport), "Rae");
    const sam = new E2eeDevice(SAM.userId, samStore, racing(samTransport), "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Before the new device");
    await sam.sync(id);
    const tablet = deviceFor(SAM, "Sam tablet");
    await tablet.device();
    await Promise.all([rae.send(id, "Rae after rekey"), sam.send(id, "Sam after rekey")]);
    expect(prepared).toBe(2);
    expect(await bodies(tablet, id)).toEqual(expect.arrayContaining(["Rae after rekey", "Sam after rekey"]));
    expect((await tablet.sync(id)).messages.size).toBe(2);
  });

  it("stays read-only when a rolling older server cannot accept OpenMLS refresh (C12.39)", { timeout: 60_000 }, async () => {
    const transport = directTransport(RAE);
    const rae = new E2eeDevice(RAE.userId, memoryStore(), { ...transport, async sync(input) { const result = await transport.sync(input); return { ...result, supportsOpenMlsRefresh: undefined }; } }, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    expect((await rae.sync(id)).ready).toBe(false);
    await expect(rae.send(id, "must wait for server")).rejects.toMatchObject({ code: "not_ready" });
    expect((await db().execute(sql`select count(*)::int as n from member_mls_groups`))[0]).toEqual({ n: 0 });
  });

  it("preserves a prepared commit while receiving another member's application message (C12.39)", { timeout: 60_000 }, async () => {
    const store = memoryStore(), transport = directTransport(RAE);
    const rae = new E2eeDevice(RAE.userId, store, transport, "Rae"), sam = deviceFor(SAM, "Sam");
    const device = await rae.device();
    await sam.device();
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Before prepared refresh");
    await sam.sync(id);
    const saved = (await store.group(id))!;
    const snapshot = JSON.parse(new TextDecoder().decode(saved.state!).split("\n").slice(1).join("\n")) as { value: { state: string } };
    const fresh = await transport.sync({ conversationId: id, deviceId: device.deviceId, after: Number.MAX_SAFE_INTEGER });
    const value = await openMls<{ state: string; pending: { commit: string } }>({ op: "commit", state: snapshot.value.state, context: { groupId: id, identity: { userId: RAE.userId, deviceId: device.deviceId, privateKey: b64(device.signKey), publicKey: b64(device.publicKey) }, directory: fresh.directory, entitled: fresh.entitled.map(entry => entry.deviceId), serverEpoch: fresh.epoch }, add: [], remove: [] });
    // Simulate a closed browser after durable preparation, before transport.
    const request = { conversationId: id, deviceId: device.deviceId, create: false, refresh: true, fromEpoch: fresh.epoch!, authority: await deliveryAuthority(id, fresh), commit: value.pending.commit, added: [], removed: [] };
    await store.saveGroup(id, utf8("freeholder:openmls:v1\n" + JSON.stringify({ kind: "openmls", value, request })), saved.cursor);
    let attemptedOnOldServer = false;
    const olderServer = new E2eeDevice(RAE.userId, store, { ...transport,
      async sync(input) { return { ...await transport.sync(input), deliveryFenceVersion: undefined }; },
      async commit(input) { attemptedOnOldServer = true; return transport.commit(input); },
    }, "Same device against older server");
    expect((await olderServer.sync(id)).ready).toBe(false);
    expect(attemptedOnOldServer).toBe(false);
    await sam.send(id, "While the refresh was prepared");
    const restarted = new E2eeDevice(RAE.userId, store, transport, "Same device after preparation");
    const status = await restarted.sync(id);
    expect(status.ready).toBe(true);
    expect([...status.messages.values()].map(message => message.body)).toContain("While the refresh was prepared");
    await restarted.send(id, "After recovered preparation");
    expect(await bodies(sam, id)).toContain("After recovered preparation");
  });

  it("refuses ciphertext prepared for a device erased between encryption and delivery (C12.39/C11.10)", { timeout: 90_000 }, async () => {
    await followMember.call({ handle: "rae" }, KIM);
    await followMember.call({ handle: "kim" }, RAE);
    const { contact } = await resolveContact.call({ email: "kim@example.test", name: "Kim" }, OWNER);
    await db().update(contacts).set({ userId: KIM.userId }).where(eq(contacts.id, contact.id));
    const erasure = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: erasure.id, method: "Synthetic member erasure proof" }, OWNER);
    const base = directTransport(RAE);
    let eraseBeforeDelivery = false;
    let staleAccepted = false;
    let staleRefused = false;
    const rae = new E2eeDevice(RAE.userId, memoryStore(), { ...base, async send(input) {
      const stale = eraseBeforeDelivery;
      if (stale) {
        eraseBeforeDelivery = false;
        await fulfillDataRequest.call({ id: erasure.id, confirmation: "ERASE" }, OWNER);
      }
      try {
        const sent = await base.send(input);
        if (stale) staleAccepted = true;
        return sent;
      } catch (error) {
        if (stale && error && typeof error === "object" && "code" in error && error.code === "conflict") staleRefused = true;
        throw error;
      }
    } }, "Rae");
    const sam = deviceFor(SAM, "Sam"), kim = deviceFor(KIM, "Kim");
    await Promise.all([rae.device(), sam.device(), kim.device()]);
    const { id } = await startConversation.call({ handles: ["sam", "kim"], title: "Erasure fence proof" }, RAE);
    await rae.send(id, "Before erasure");
    await Promise.all([sam.sync(id), kim.sync(id)]);
    eraseBeforeDelivery = true;
    await rae.send(id, "Only the remaining devices may read this");
    expect(staleAccepted).toBe(false);
    expect(staleRefused).toBe(true);
    expect(await bodies(sam, id)).toContain("Only the remaining devices may read this");
  });

  it("keeps legacy writers without an encryption-time authority witness read-only (C12.39)", { timeout: 60_000 }, async () => {
    const rae = deviceFor(RAE, "Rae"), sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Current protected writer");
    const deviceId = (await rae.device()).deviceId;
    const epoch = (await e2eeSync.call({ conversationId: id, deviceId, after: 0 }, RAE)).epoch!;
    const oldCall = sendEncrypted.call.bind(sendEncrypted) as (input: unknown, actor: Member) => Promise<unknown>;
    expect((await failure(oldCall({ conversationId: id, deviceId, epoch, ciphertext: "AAAA", frankTag: "A".repeat(43) + "=", attachments: [] }, RAE))).code).toBe("validation");
    expect((await viewConversation.call({ id }, SAM)).messages).toHaveLength(1);
  });

  it("refuses prepared group secrets after unchanged-epoch erasure and safely rebuilds the commit (C12.39)", { timeout: 90_000 }, async () => {
    await followMember.call({ handle: "rae" }, KIM);
    await followMember.call({ handle: "kim" }, RAE);
    const { contact } = await resolveContact.call({ email: "kim@example.test", name: "Kim" }, OWNER);
    await db().update(contacts).set({ userId: KIM.userId }).where(eq(contacts.id, contact.id));
    const erasure = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: erasure.id, method: "Synthetic prepared-commit erasure proof" }, OWNER);
    const base = directTransport(RAE);
    let erase = false, staleAccepted = false, staleRefused = false;
    const rae = new E2eeDevice(RAE.userId, memoryStore(), { ...base, async commit(input) {
      const stale = erase;
      if (stale) { erase = false; await fulfillDataRequest.call({ id: erasure.id, confirmation: "ERASE" }, OWNER); }
      try { const ack = await base.commit(input); if (stale) staleAccepted = true; return ack; }
      catch (error) { if (stale && error && typeof error === "object" && "code" in error && error.code === "conflict") staleRefused = true; throw error; }
    } }, "Rae");
    const sam = deviceFor(SAM, "Sam"), kim = deviceFor(KIM, "Kim");
    await Promise.all([rae.device(), sam.device(), kim.device()]);
    const { id } = await startConversation.call({ handles: ["sam", "kim"], title: "Prepared commit fence" }, RAE);
    await rae.send(id, "Before prepared commit");
    await Promise.all([sam.sync(id), kim.sync(id)]);
    const phone = deviceFor(SAM, "New entitled phone");
    await phone.device();
    erase = true;
    await rae.send(id, "Only current devices receive group secrets");
    expect(staleAccepted).toBe(false);
    expect(staleRefused).toBe(true);
    expect(await bodies(sam, id)).toContain("Only current devices receive group secrets");
    expect(await bodies(phone, id)).toEqual(["Only current devices receive group secrets"]);
  });

  it("serializes an in-flight privacy erasure before a new encrypted snapshot (C12.39/C11.10)", { timeout: 90_000 }, async () => {
    await followMember.call({ handle: "rae" }, KIM);
    await followMember.call({ handle: "kim" }, RAE);
    const { contact } = await resolveContact.call({ email: "kim@example.test", name: "Kim" }, OWNER);
    await db().update(contacts).set({ userId: KIM.userId }).where(eq(contacts.id, contact.id));
    const erasure = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: erasure.id, method: "Synthetic locked erasure proof" }, OWNER);
    const base = directTransport(RAE);
    let observe = false, signalSync!: () => void;
    const syncStarted = new Promise<void>(resolve => { signalSync = resolve; });
    const deliveredEpochs: number[] = [];
    const rae = new E2eeDevice(RAE.userId, memoryStore(), { ...base,
      async sync(input) { if (observe) signalSync(); return base.sync(input); },
      async send(input) { if (observe) deliveredEpochs.push(input.epoch); return base.send(input); },
    }, "Rae");
    const sam = deviceFor(SAM, "Sam"), kim = deviceFor(KIM, "Kim");
    await Promise.all([rae.device(), sam.device(), kim.device()]);
    const { id } = await startConversation.call({ handles: ["sam", "kim"], title: "Locked erasure proof" }, RAE);
    await rae.send(id, "Before locked erasure");
    await Promise.all([sam.sync(id), kim.sync(id)]);
    let release!: () => void, acquired!: () => void;
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const mutex = db().transaction(async tx => {
      await tx.select({ id: memberConversations.id }).from(memberConversations).where(eq(memberConversations.id, id)).for("update");
      acquired(); await unlock;
    });
    await locked;
    const erasing = fulfillDataRequest.call({ id: erasure.id, confirmation: "ERASE" }, OWNER);
    let sending: Promise<string | null> | undefined;
    try {
      await expect.poll(async () => {
        try {
          await db().transaction(async tx => { await tx.select({ id: memberProfiles.userId }).from(memberProfiles).where(eq(memberProfiles.userId, KIM.userId)).for("share", { noWait: true }); });
          return false;
        } catch (error) {
          let cause: unknown = error;
          for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
            if ("code" in cause && cause.code === "55P03") return true;
            cause = "cause" in cause ? cause.cause : undefined;
          }
          throw error;
        }
      }).toBe(true);
      observe = true;
      sending = rae.send(id, "After locked erasure");
      await syncStarted;
      release();
      await Promise.all([mutex, erasing, sending]);
      expect(deliveredEpochs).toEqual([2]);
      expect(await bodies(sam, id)).toContain("After locked erasure");
    } finally {
      release();
      await Promise.allSettled([mutex, erasing, ...(sending ? [sending] : [])]);
    }
  });

  it("retains its own accepted message across response loss and device restart (C12.39)", { timeout: 60_000 }, async () => {
    const store = memoryStore(), base = directTransport(RAE);
    let loseResponse = false;
    const rae = new E2eeDevice(RAE.userId, store, { ...base, async send(input) {
      const accepted = await base.send(input);
      if (loseResponse) { loseResponse = false; throw new Error("Synthetic lost accepted message response"); }
      return accepted;
    } }, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Before response loss");
    await sam.sync(id);
    loseResponse = true;
    await expect(rae.send(id, "Accepted before the response was lost")).rejects.toThrow("Synthetic lost accepted message response");
    expect(await bodies(sam, id)).toContain("Accepted before the response was lost");
    const restarted = new E2eeDevice(RAE.userId, store, base, "Same device after restart");
    expect(await bodies(restarted, id)).toContain("Accepted before the response was lost");
  });

  it("keeps an uncertain send private until an exact own receipt arrives, without retransmitting (C12.39)", { timeout: 60_000 }, async () => {
    const store = memoryStore(), base = directTransport(RAE);
    let lost = false, corrupt = false, sends = 0, deviceId = "";
    const transport = { ...base,
      async send(input: Parameters<typeof base.send>[0]) { sends++; const ack = await base.send(input); if (lost) throw new Error("Synthetic uncertain delivery"); return ack; },
      async sync(input: Parameters<typeof base.sync>[0]) {
        const value = await base.sync(input);
        return corrupt ? { ...value, log: value.log.map(entry => entry.kind === "application" && entry.senderDeviceId === deviceId ? { ...entry, frankTag: "A".repeat(43) + "=" } : entry) } : value;
      },
    };
    const rae = new E2eeDevice(RAE.userId, store, transport, "Rae"), sam = deviceFor(SAM, "Sam");
    deviceId = (await rae.device()).deviceId;
    await sam.device();
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Before uncertainty");
    lost = true;
    await expect(rae.send(id, "Only after an exact receipt")).rejects.toThrow("Synthetic uncertain delivery");
    const before = (await store.group(id))!;
    expect([...(await store.messages(id)).values()].map(message => message.body)).not.toContain("Only after an exact receipt");
    const restarted = new E2eeDevice(RAE.userId, store, transport, "Rae restarted");
    corrupt = true;
    await expect(restarted.sync(id)).rejects.toThrow(/receipt/);
    expect((await store.group(id))!.cursor).toBe(before.cursor);
    expect([...(await store.messages(id)).values()].map(message => message.body)).not.toContain("Only after an exact receipt");
    corrupt = false;
    expect(await bodies(restarted, id)).toContain("Only after an exact receipt");
    expect(sends).toBe(2);
    expect((await viewConversation.call({ id }, SAM)).messages).toHaveLength(2);
  });

  it("bounds uncertain deliveries and refuses a full queue without advancing its ratchet (C12.39)", { timeout: 120_000 }, async () => {
    const store = memoryStore(), base = directTransport(RAE);
    let unavailable = false, sends = 0;
    const transport = { ...base, async send(input: Parameters<typeof base.send>[0]) { sends++; if (unavailable) throw new Error("Synthetic transport unavailable"); return base.send(input); } };
    const rae = new E2eeDevice(RAE.userId, store, transport, "Rae"), sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Before outage");
    unavailable = true;
    for (let i = 0; i < MAX_UNCONFIRMED_OUTGOING; i++) await expect(rae.send(id, `Uncertain ${i}`)).rejects.toThrow("Synthetic transport unavailable");
    const restarted = new E2eeDevice(RAE.userId, store, transport, "Same device");
    await restarted.sync(id);
    const before = (await store.group(id))!;
    await expect(restarted.send(id, "Queue is full")).rejects.toMatchObject({ code: "not_ready" });
    expect((await store.group(id))!.state).toEqual(before.state);
    expect(sends).toBe(MAX_UNCONFIRMED_OUTGOING + 1);
    expect((await viewConversation.call({ id }, SAM)).messages).toHaveLength(1);
  });

  it("clears an explicitly refused candidate while preserving the advanced sender ratchet (C12.39)", { timeout: 60_000 }, async () => {
    const store = memoryStore(), base = directTransport(RAE);
    let refuse = false;
    const rae = new E2eeDevice(RAE.userId, store, { ...base, async send(input) {
      if (refuse) throw Object.assign(new Error("Synthetic explicit validation refusal"), { code: "validation" });
      return base.send(input);
    } }, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
    await rae.send(id, "Before refusal");
    await sam.sync(id);
    const before = (await store.group(id))!.state;
    refuse = true;
    await expect(rae.send(id, "Refused private candidate")).rejects.toMatchObject({ code: "validation" });
    const after = (await store.group(id))!.state!;
    expect(after).not.toEqual(before);
    expect(new TextDecoder().decode(after)).not.toContain("Refused private candidate");
    refuse = false;
    const restarted = new E2eeDevice(RAE.userId, store, base, "Same advanced device");
    await restarted.send(id, "After refusal");
    expect(await bodies(sam, id)).toEqual(["Before refusal", "After refusal"]);
  });

  it("recovers accepted call keys after a lost response (C12.39)", { timeout: 60_000 }, async () => {
    setSfuForTests({ id: "synthetic", url: "ws://sfu.test", issue: () => "synthetic-token", participants: async () => [], remove: async () => undefined });
    try {
      const store = memoryStore(), base = directTransport(RAE);
      let lose = true, sends = 0;
      const rae = new E2eeDevice(RAE.userId, store, { ...base, async sendCallKey(input) { sends++; await base.sendCallKey(input); if (lose) throw new Error("Synthetic lost call-key response"); return { ok: true }; } }, "Rae");
      const sam = deviceFor(SAM, "Sam");
      await Promise.all([rae.device(), sam.device()]);
      const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
      await rae.send(id, "Call preparation");
      const call = await startGroupCall.call({ conversationId: id, media: "voice" }, RAE);
      await expect(rae.startCallKey(id, call.id)).rejects.toThrow("Synthetic lost call-key response");
      expect(await store.callKey(call.id)).toBeNull();
      const winner = await sam.callKey(id, call.id);
      expect(winner).toBeTruthy();
      lose = false;
      const restarted = new E2eeDevice(RAE.userId, store, base, "Rae restarted");
      expect(await restarted.startCallKey(id, call.id)).toBe(winner);
      expect(await store.callKey(call.id)).toBe(winner);
      expect(sends).toBe(1);
    } finally { setSfuForTests(undefined); }
  });

  it("keeps uncertain call keys out of the official slot and refuses blind replacements (C12.39)", { timeout: 60_000 }, async () => {
    setSfuForTests({ id: "synthetic", url: "ws://sfu.test", issue: () => "synthetic-token", participants: async () => [], remove: async () => undefined });
    try {
      const store = memoryStore(), base = directTransport(RAE);
      let sends = 0;
      const transport = { ...base, async sendCallKey() { sends++; throw new Error("Synthetic uncertain call delivery"); } };
      const rae = new E2eeDevice(RAE.userId, store, transport, "Rae"), sam = deviceFor(SAM, "Sam");
      await Promise.all([rae.device(), sam.device()]);
      const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
      await rae.send(id, "Call preparation");
      const call = await startGroupCall.call({ conversationId: id, media: "voice" }, RAE);
      await expect(rae.startCallKey(id, call.id)).rejects.toThrow("Synthetic uncertain call delivery");
      const restarted = new E2eeDevice(RAE.userId, store, { ...transport, async sendCallKey(input) {
        if (!input.fresh) return base.sendCallKey(input);
        return transport.sendCallKey();
      } }, "Same device");
      await restarted.sync(id);
      await expect(restarted.startCallKey(id, call.id)).rejects.toMatchObject({ code: "not_ready" });
      expect(sends).toBe(1);
      expect(await store.callKey(call.id)).toBeNull();
      const winner = await sam.startCallKey(id, call.id);
      expect(await restarted.callKey(id, call.id)).toBe(winner);
      const phone = deviceFor(RAE, "Rae phone after uncertain candidate");
      await phone.device();
      await restarted.send(id, "Admit the phone with the confirmed winning key");
      expect(await phone.callKey(id, call.id)).toBe(winner);
    } finally { setSfuForTests(undefined); }
  });

  it("discards a refused call-key candidate and adopts the actual winning device key (C12.39)", { timeout: 60_000 }, async () => {
    setSfuForTests({ id: "synthetic", url: "ws://sfu.test", issue: () => "synthetic-token", participants: async () => [], remove: async () => undefined });
    try {
      const store = memoryStore(), base = directTransport(RAE), sam = deviceFor(SAM, "Sam");
      let winner: string | null = null, sends = 0;
      const rae = new E2eeDevice(RAE.userId, store, { ...base, async sendCallKey(input) {
        sends++;
        expect(await store.callKey(input.callId)).toBeNull();
        winner = await sam.startCallKey(input.conversationId, input.callId);
        return base.sendCallKey(input);
      } }, "Rae");
      await Promise.all([rae.device(), sam.device()]);
      const { id } = await startConversation.call({ handles: ["sam"] }, RAE);
      await rae.send(id, "Call preparation");
      const call = await startGroupCall.call({ conversationId: id, media: "voice" }, RAE);
      expect(await rae.startCallKey(id, call.id)).toBe(winner);
      expect(await store.callKey(call.id)).toBe(winner);
      expect(sends).toBe(1);
    } finally { setSfuForTests(undefined); }
  });

  it("stays plaintext, and says so, until everyone has a device", async () => {
    const rae = deviceFor(RAE, "Rae");
    await rae.device();
    const { id } = await startConversation.call({ handles: ["sam"], body: "Hi Sam" }, RAE);
    expect(await rae.send(id, "Are you there?")).toBeNull();
    expect((await rae.sync(id)).missing).toEqual([SAM.userId]);
    expect((await viewConversation.call({ id }, SAM)).conversation.e2ee).toBe(false);
  });
});
