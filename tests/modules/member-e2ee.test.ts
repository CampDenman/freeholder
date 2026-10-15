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
import { ServiceError } from "@/core/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { followMember } from "@/modules/members/graph";
import { leaveConversation, sendMessage, startConversation, unsendMessage, viewConversation } from "@/modules/members/messages";
import { reportContent } from "@/modules/members/reports";
import { claimKeyPackages, e2eeCommit, e2eeSync, publishKeyPackages, registerDevice, revokeDevice, sendEncrypted } from "@/modules/members/e2ee/service";
import { E2eeDevice, type DeviceRecord, type E2eeStore, type E2eeTransport, type ReadMessage, type StoredKeyPackage } from "@/modules/members/e2ee/engine";
import { memberReports } from "@/modules/members/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

type Member = typeof CUSTOMER;
const RAE = CUSTOMER;
const SAM: Member = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM: Member = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };

function memoryStore(): E2eeStore {
  let device: DeviceRecord | null = null;
  const packages = new Map<string, StoredKeyPackage>();
  const groups = new Map<string, { state: Uint8Array | null; cursor: number }>();
  const messages = new Map<string, Map<string, ReadMessage>>();
  return {
    device: async () => device,
    saveDevice: async (d) => { device = d; },
    keyPackage: async (id) => packages.get(id) ?? null,
    saveKeyPackages: async (list) => { for (const p of list) packages.set(p.id, p); },
    dropKeyPackage: async (id) => { packages.delete(id); },
    group: async (id) => groups.get(id) ?? null,
    saveGroup: async (id, state, cursor) => { groups.set(id, { state, cursor }); },
    messages: async (id) => new Map(messages.get(id) ?? []),
    saveMessage: async (id, mid, m) => { messages.set(id, new Map(messages.get(id) ?? []).set(mid, m)); },
    dropMessage: async (id, mid) => { messages.get(id)?.delete(mid); },
    clear: async () => { device = null; packages.clear(); groups.clear(); messages.clear(); },
  };
}

/** The services, called as the member, with errors carrying their codes as the server actions do. */
function directTransport(actor: Member): E2eeTransport {
  const wrap = <I, O>(service: { call(input: I, actor: Member): Promise<O> }) => async (input: I) => {
    try {
      return await service.call(input, actor);
    } catch (error) {
      if (error instanceof ServiceError) throw Object.assign(new Error(error.message), { code: error.code });
      throw error;
    }
  };
  return {
    register: wrap(registerDevice),
    publish: wrap(publishKeyPackages),
    sync: wrap(e2eeSync),
    claim: wrap(claimKeyPackages),
    commit: wrap(e2eeCommit),
    send: wrap(sendEncrypted),
  };
}

const deviceFor = (actor: Member, label: string) => new E2eeDevice(actor.userId, memoryStore(), directTransport(actor), label);
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

  it("stays plaintext, and says so, until everyone has a device", async () => {
    const rae = deviceFor(RAE, "Rae");
    await rae.device();
    const { id } = await startConversation.call({ handles: ["sam"], body: "Hi Sam" }, RAE);
    expect(await rae.send(id, "Are you there?")).toBeNull();
    expect((await rae.sync(id)).missing).toEqual([SAM.userId]);
    expect((await viewConversation.call({ id }, SAM)).conversation.e2ee).toBe(false);
  });
});
