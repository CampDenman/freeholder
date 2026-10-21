// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: end-to-end encrypted member messages. Real MLS devices (the same
// engine browsers run, with memory stores) talk through the real services;
// the database is then searched for anything readable.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { followMember } from "@/modules/members/graph";
import { leaveConversation, sendMessage, startConversation, unsendMessage, viewConversation } from "@/modules/members/messages";
import { reportContent } from "@/modules/members/reports";
import { e2eeSync, registerDevice, revokeDevice, sendEncrypted } from "@/modules/members/e2ee/service";
import type { E2eeDevice } from "@/modules/members/e2ee/engine";
import { deviceFor } from "../helpers/e2ee";
import { memberReports, memberSealedBlobs } from "@/modules/members/schema";
import { purgeSealedBlobs, sealedBlobAccess, uploadSealedBlob } from "@/modules/members/sealed-blobs";
import { openFile, sealFile } from "@/modules/members/e2ee/wire";
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
    expect((await failure(sendEncrypted.call({ conversationId: id, deviceId, epoch: stale.epoch!, ciphertext: "AAAA", frankTag: "A".repeat(43) + "=", attachments: [] }, RAE))).code).toBe("conflict");
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

  it("stays plaintext, and says so, until everyone has a device", async () => {
    const rae = deviceFor(RAE, "Rae");
    await rae.device();
    const { id } = await startConversation.call({ handles: ["sam"], body: "Hi Sam" }, RAE);
    expect(await rae.send(id, "Are you there?")).toBeNull();
    expect((await rae.sync(id)).missing).toEqual([SAM.userId]);
    expect((await viewConversation.call({ id }, SAM)).conversation.e2ee).toBe(false);
  });
});
