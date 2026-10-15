// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.24: group calls. Who may start, be rung and join; the SFU credential;
// and the media key, which only devices in the conversation's MLS group ever
// receive — including one that joins after the call began.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import { listNotifications } from "@/core/notifications/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { followMember } from "@/modules/members/graph";
import { startConversation } from "@/modules/members/messages";
import { activeGroupCall, joinGroupCall, leaveGroupCall, startGroupCall, viewGroupCall } from "@/modules/members/group-calls";
import { memberMlsLog } from "@/modules/members/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { deviceFor } from "../helpers/e2ee";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };
const SECRET = "test-livekit-secret-for-group-calls";

function decodeToken(token: string) {
  const [header, claims, signature] = token.split(".");
  expect(createHmac("sha256", SECRET).update(`${header}.${claims}`).digest("base64url")).toBe(signature);
  return JSON.parse(Buffer.from(claims!, "base64url").toString()) as { iss: string; sub: string; exp: number; video: { room: string; roomJoin: boolean } };
}

describe.runIf(hasDatabase)("group calls (C12.24)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    process.env.LIVEKIT_URL = "ws://127.0.0.1:7880";
    process.env.LIVEKIT_API_KEY = "testkey";
    process.env.LIVEKIT_API_SECRET = SECRET;
    resetEnvForTests();
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
    // Sam follows Rae, so Sam's seat is active; Kim does not, so Kim's is a request.
    await followMember.call({ handle: "rae" }, SAM);
  });
  afterEach(() => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    resetEnvForTests();
  });
  afterAll(closeDb);

  it("rings only accepted members, hands out room credentials, and delivers the key through MLS", { timeout: 60_000 }, async () => {
    const rae = deviceFor(RAE, "Rae");
    const sam = deviceFor(SAM, "Sam");
    const kim = deviceFor(KIM, "Kim");
    await Promise.all([rae.device(), sam.device(), kim.device()]);
    const { id: conversationId } = await startConversation.call({ handles: ["sam", "kim"], title: "Climbing" }, RAE);
    // No encrypted group yet: no call.
    expect((await failure(startGroupCall.call({ conversationId, media: "video" }, RAE))).code).toBe("validation");
    await rae.send(conversationId, "Call at 6?");

    // Kim has not accepted the request: cannot start, is not rung, cannot join.
    expect((await failure(startGroupCall.call({ conversationId, media: "video" }, KIM))).code).toBe("permission");
    const { id, started } = await startGroupCall.call({ conversationId, media: "video" }, RAE);
    expect(started).toBe(true);
    expect(await startGroupCall.call({ conversationId, media: "voice" }, SAM)).toEqual({ id, started: false });
    expect((await listNotifications.call({}, SAM)).map((n) => n.title)).toContain("Rae started a group call");
    expect((await listNotifications.call({}, KIM)).map((n) => n.title)).not.toContain("Rae started a group call");
    expect((await failure(joinGroupCall.call({ id, deviceId: (await kim.device()).deviceId }, KIM))).code).toBe("permission");
    expect((await activeGroupCall.call({ conversationId }, SAM)).call).toEqual({ id, media: "video" });

    // The key leaves Rae's device inside the MLS group; Sam's device opens it.
    const key = await rae.startCallKey(conversationId, id);
    expect(await sam.callKey(conversationId, id)).toBe(key);
    const control = await db().select().from(memberMlsLog).where(and(eq(memberMlsLog.callId, id), eq(memberMlsLog.kind, "control")));
    expect(control).toHaveLength(1);
    expect(control[0]!.payload).not.toContain(key);

    // The credential is for this room, this person and device, and expires.
    const samDevice = (await sam.device()).deviceId;
    const joined = await joinGroupCall.call({ id, deviceId: samDevice }, SAM);
    expect(joined.url).toBe("ws://127.0.0.1:7880");
    const claims = decodeToken(joined.token);
    expect(claims).toMatchObject({ iss: "testkey", sub: `${SAM.userId}:${samDevice}`, video: { room: `freeholder-${id}`, roomJoin: true } });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    // A device outside the group cannot get one, even for a member.
    const samLaptop = deviceFor(SAM, "Sam laptop");
    expect((await failure(joinGroupCall.call({ id, deviceId: (await samLaptop.device()).deviceId }, SAM))).code).toBe("permission");

    // The device that adds the laptop to the group sends it the key in the same sync.
    await rae.send(conversationId, "Sam, your laptop is in now");
    expect(await samLaptop.callKey(conversationId, id)).toBe(key);
    expect(await db().select().from(memberMlsLog).where(and(eq(memberMlsLog.callId, id), eq(memberMlsLog.kind, "control")))).toHaveLength(2);
    expect((await joinGroupCall.call({ id, deviceId: (await samLaptop.device()).deviceId }, SAM)).room).toBe(`freeholder-${id}`);

    expect((await viewGroupCall.call({ id }, RAE)).inCall.map((p) => p.handle)).toEqual(["sam"]);
    await leaveGroupCall.call({ id }, SAM);
    expect((await viewGroupCall.call({ id }, RAE)).state).toBe("ended");
  });

  it("is not offered without an SFU", async () => {
    delete process.env.LIVEKIT_URL;
    resetEnvForTests();
    const rae = deviceFor(RAE, "Rae");
    const sam = deviceFor(SAM, "Sam");
    await Promise.all([rae.device(), sam.device()]);
    const { id: conversationId } = await startConversation.call({ handles: ["sam"], title: "Two of us" }, RAE);
    await rae.send(conversationId, "hi");
    expect((await activeGroupCall.call({ conversationId }, RAE)).available).toBe(false);
    expect((await failure(startGroupCall.call({ conversationId, media: "voice" }, RAE))).code).toBe("validation");
  });
});
