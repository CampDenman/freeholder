// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.07: only connections (or an accepted message request) can ring a
// member; one call at a time; signalling passes once and is deleted; TURN
// credentials are short-lived and never default to a third party.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import { listNotifications } from "@/core/notifications/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { befriendMember, followMember, setMemberRelation } from "@/modules/members/graph";
import { answerMessageRequest, startConversation } from "@/modules/members/messages";
import {
  answerCall,
  callSettings,
  callStatus,
  endCall,
  incomingCalls,
  relayCredentials,
  sendSignal,
  startCall,
  takeSignals,
} from "@/modules/members/calls";
import { memberCallSignals, memberCalls } from "@/modules/members/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };

describe("TURN credentials", () => {
  afterEach(() => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_SECRET;
    delete process.env.STUN_URLS;
    resetEnvForTests();
  });
  it("offers nothing third-party by default and short-lived coturn credentials when configured", () => {
    resetEnvForTests();
    expect(relayCredentials("u1")).toEqual({ iceServers: [], relayConfigured: false });
    process.env.TURN_URLS = "turn:turn.example.test:3478?transport=udp, turns:turn.example.test:5349";
    process.env.TURN_SECRET = "a-long-shared-turn-secret";
    resetEnvForTests();
    const now = Date.parse("2026-10-14T12:00:00Z");
    const { iceServers, relayConfigured } = relayCredentials("u1", now);
    const username = `${now / 1000 + 3600}:u1`;
    expect(relayConfigured).toBe(true);
    expect(iceServers).toEqual([{
      urls: ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349"],
      username,
      credential: createHmac("sha1", "a-long-shared-turn-secret").update(username).digest("base64"),
    }]);
  });
});

describe.runIf(hasDatabase)("member calls (C12.07)", () => {
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
    }
  });
  afterAll(closeDb);

  it("lets only connections or an accepted request ring someone", async () => {
    expect((await failure(startCall.call({ handle: "rae", media: "video" }, SAM))).code).toBe("not_found");
    await updateMyMembership.call({ isPrivate: false }, SAM);
    await followMember.call({ handle: "sam" }, RAE);
    const call = await startCall.call({ handle: "rae", media: "video" }, SAM);
    expect(call).toMatchObject({ state: "ringing", role: "caller", other: { handle: "rae" } });
    expect((await incomingCalls.call({}, RAE)).map((c) => c.id)).toEqual([call.id]);
    expect((await failure(startCall.call({ handle: "rae", media: "voice" }, KIM))).code).toBe("not_found");
    await endCall.call({ id: call.id }, SAM);
    const { id: conversation } = await startConversation.call({ handles: ["rae"], body: "Can I call you?" }, KIM);
    expect((await failure(startCall.call({ handle: "rae", media: "voice" }, KIM))).code).toBe("not_found");
    await answerMessageRequest.call({ conversationId: conversation, accept: true }, RAE);
    expect((await startCall.call({ handle: "rae", media: "voice" }, KIM)).state).toBe("ringing");
  });

  it("answers, passes signals exactly once, and cleans up on hang-up", async () => {
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    const call = await startCall.call({ handle: "rae", media: "video" }, SAM);
    expect((await failure(startCall.call({ handle: "sam", media: "voice" }, RAE))).code).toBe("conflict");
    await sendSignal.call({ callId: call.id, kind: "offer", payload: { type: "offer", sdp: "v=0 offer" } }, SAM);
    await sendSignal.call({ callId: call.id, kind: "candidate", payload: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } }, SAM);
    expect((await answerCall.call({ id: call.id, accept: true }, RAE)).state).toBe("active");
    const got = await takeSignals.call({ callId: call.id }, RAE);
    expect(got.signals.map((s) => s.kind)).toEqual(["offer", "candidate"]);
    expect((await takeSignals.call({ callId: call.id }, RAE)).signals).toEqual([]);
    expect((await takeSignals.call({ callId: call.id }, SAM)).signals).toEqual([]);
    await sendSignal.call({ callId: call.id, kind: "answer", payload: { type: "answer", sdp: "v=0 answer" } }, RAE);
    expect((await failure(callStatus.call({ id: call.id }, KIM))).code).toBe("not_found");
    expect((await failure(sendSignal.call({ callId: call.id, kind: "candidate", payload: { candidate: "x" } }, KIM))).code).toBe("not_found");
    await endCall.call({ id: call.id }, RAE);
    expect((await callStatus.call({ id: call.id }, SAM)).state).toBe("ended");
    expect(await db().select().from(memberCallSignals)).toEqual([]);
    expect((await failure(sendSignal.call({ callId: call.id, kind: "candidate", payload: { candidate: "late" } }, SAM))).code).toBe("conflict");
  });

  it("issues relay credentials only to a member on a live call (C11.10)", async () => {
    const outsider = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c9" };
    await db().insert(users).values({ id: outsider.userId, email: "outsider@example.test", role: "customer" });
    expect((await failure(callSettings.call({}, outsider))).code).toBe("permission");
    expect((await failure(callSettings.call({}, SAM))).code).toBe("conflict");
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    const call = await startCall.call({ handle: "rae", media: "voice" }, SAM);
    expect((await callSettings.call({}, SAM)).iceServers).toBeDefined();
    expect((await callSettings.call({}, RAE)).iceServers).toBeDefined();
    expect((await failure(callSettings.call({}, KIM))).code).toBe("conflict");
    await endCall.call({ id: call.id }, SAM);
    expect((await failure(callSettings.call({}, SAM))).code).toBe("conflict");
  });

  it("turns unanswered ringing into a missed call and refuses across a block", async () => {
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    const call = await startCall.call({ handle: "rae", media: "voice" }, SAM);
    await db().update(memberCalls).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(memberCalls.id, call.id));
    expect(await incomingCalls.call({}, RAE)).toEqual([]);
    expect((await callStatus.call({ id: call.id }, SAM)).state).toBe("missed");
    expect((await listNotifications.call({}, RAE)).map((n) => n.title)).toContain("Missed call from Sam");
    await setMemberRelation.call({ handle: "sam", kind: "block", on: true }, RAE);
    expect((await failure(startCall.call({ handle: "rae", media: "voice" }, SAM))).code).toBe("not_found");
  });
});
