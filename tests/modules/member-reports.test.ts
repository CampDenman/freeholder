// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.12: members report what they can see, staff decide in one queue, the
// decision removes or suspends, and everyone involved hears the outcome.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { auditLog } from "@/core/events/schema";
import { listNotifications } from "@/core/notifications/service";
import { joinSite, myMembership } from "@/modules/members/service";
import { commentOnPost, createPost, viewPost } from "@/modules/members/posts";
import { startConversation, viewConversation } from "@/modules/members/messages";
import { listReports, myReports, reportContent, resolveReport } from "@/modules/members/reports";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };

describe.runIf(hasDatabase)("member reports (C12.12)", () => {
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

  it("groups reports on one post, removes it, and tells the author and reporters", async () => {
    const post = await createPost.call({ body: "Buy followers cheap at spam.example", visibility: "public" }, SAM);
    const target = { targetType: "post" as const, targetId: post.id };
    expect((await failure(reportContent.call({ ...target, reason: "spam" }, SAM))).code).toBe("validation");
    await reportContent.call({ ...target, reason: "spam", details: "Spam link." }, RAE);
    await reportContent.call({ ...target, reason: "spam" }, RAE);
    await reportContent.call({ ...target, reason: "scam" }, KIM);
    expect((await failure(listReports.call({}, RAE))).code).toBe("permission");
    const queue = await listReports.call({}, OWNER);
    expect(queue.map((r) => [r.targetType, r.reporterCount, r.excerpt, r.subject.handle])).toEqual([["post", 2, "Buy followers cheap at spam.example", "sam"]]);

    expect((await failure(resolveReport.call({ id: queue[0]!.id, decision: "remove" }, OWNER))).code).toBe("validation");
    expect((await resolveReport.call({ id: queue[0]!.id, decision: "remove", note: "Spam links are not allowed." }, OWNER)).resolved).toBe(2);
    expect((await failure(viewPost.call({ id: post.id }, RAE))).code).toBe("not_found");
    expect(await listReports.call({}, OWNER)).toEqual([]);
    expect((await listReports.call({ state: "actioned" }, OWNER)).map((r) => [r.action, r.resolutionNote])).toEqual([["removed", "Spam links are not allowed."]]);
    expect((await myReports.call({}, KIM)).map((r) => r.state)).toEqual(["actioned"]);
    expect((await failure(resolveReport.call({ id: queue[0]!.id, decision: "dismiss" }, OWNER))).code).toBe("conflict");

    const topics = async (actor: typeof RAE) => (await listNotifications.call({}, actor)).filter((n) => n.topic === "members.safety").length;
    expect(await topics(SAM)).toBe(1);
    expect(await topics(RAE)).toBe(1);
    expect(await topics(KIM)).toBe(1);
    const audited = await db().select().from(auditLog);
    expect(audited.some((a) => a.action === "members.resolveReport")).toBe(true);
  });

  it("only takes reports on things the reporter can see, and suspends from the queue", async () => {
    const hidden = await createPost.call({ body: "Only me", visibility: "only_me" }, SAM);
    expect((await failure(reportContent.call({ targetType: "post", targetId: hidden.id, reason: "other" }, RAE))).code).toBe("not_found");

    const { id: conversationId } = await startConversation.call({ handles: ["rae"], body: "You will regret this." }, SAM);
    const [message] = (await viewConversation.call({ id: conversationId }, RAE)).messages;
    expect((await failure(reportContent.call({ targetType: "message", targetId: message!.id, reason: "harassment" }, KIM))).code).toBe("not_found");
    await reportContent.call({ targetType: "message", targetId: message!.id, reason: "harassment", details: "Threat." }, RAE);

    const open = await listReports.call({}, OWNER);
    expect(open.map((r) => [r.targetType, r.excerpt])).toEqual([["message", "You will regret this."]]);
    await resolveReport.call({ id: open[0]!.id, decision: "remove_and_suspend", note: "Threats get you suspended." }, OWNER);
    expect((await myMembership.call({}, SAM))?.status).toBe("suspended");
    expect((await viewConversation.call({ id: conversationId }, RAE)).messages.map((m) => m.body)).toEqual([null]);
  });

  it("dismisses without touching the content, and handles comments and members", async () => {
    const post = await createPost.call({ body: "Sunset over the bay", visibility: "public" }, RAE);
    const comment = await commentOnPost.call({ postId: post.id, body: "Ugly photo" }, SAM);
    await reportContent.call({ targetType: "comment", targetId: comment.id, reason: "harassment" }, RAE);
    await reportContent.call({ targetType: "member", targetId: SAM.userId, reason: "impersonation" }, KIM);
    const queue = await listReports.call({}, OWNER);
    expect(queue.map((r) => r.targetType).sort()).toEqual(["comment", "member"]);
    const memberReport = queue.find((r) => r.targetType === "member")!;
    expect((await failure(resolveReport.call({ id: memberReport.id, decision: "remove", note: "Not allowed here." }, OWNER))).code).toBe("validation");
    await resolveReport.call({ id: memberReport.id, decision: "dismiss" }, OWNER);
    await resolveReport.call({ id: queue.find((r) => r.targetType === "comment")!.id, decision: "dismiss" }, OWNER);
    expect((await viewPost.call({ id: post.id }, KIM)).comments.map((c) => c.body)).toEqual(["Ugly photo"]);
    expect((await myMembership.call({}, SAM))?.status).toBe("active");
  });
});
