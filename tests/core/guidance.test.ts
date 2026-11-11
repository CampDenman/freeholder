// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable first-win progress: real outcomes, per-user isolation, skip/resume,
// reset and capability-change reactivation.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {z} from "zod";
import { and, eq,sql } from "drizzle-orm";
import { roleGrants, roles, users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { guidanceProgress } from "@/core/guidance/schema";
import {
  dismissGuidance,
  listGuidance,
  resetGuidance,
  startGuidance,
} from "@/core/guidance/service";
import { setMyMarketingPreference } from "@/core/privacy/service";
import { DEFAULT_ROLES } from "@/core/roles/defaults";
import {defineService,type Actor} from "@/core/service";
import {
  updateNotificationPreference,
  updateNotificationSettings,
} from "@/core/notifications/service";
import { issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import { createForm, submitForm } from "@/modules/forms/service";
import {
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

type UserActor = Extract<Actor, { kind: "user" }>;

const IDS = {
  owner: "10000000-0000-4000-8000-000000000001",
  bookkeeper: "10000000-0000-4000-8000-000000000002",
  secondBookkeeper: "10000000-0000-4000-8000-000000000003",
  customer: "10000000-0000-4000-8000-000000000004",
  editor: "10000000-0000-4000-8000-000000000005",
  custom: "10000000-0000-4000-8000-000000000006",
} as const;

function defaultActor(roleKey: string, userId: string): UserActor {
  const role = DEFAULT_ROLES.find((candidate) => candidate.key === roleKey);
  if (!role) throw new Error(`missing default role ${roleKey}`);
  return { kind: "user", userId, role: role.key, grants: role.grants };
}

const OWNER = defaultActor("owner", IDS.owner);
const BOOKKEEPER = defaultActor("bookkeeper", IDS.bookkeeper);
const SECOND_BOOKKEEPER = defaultActor("bookkeeper", IDS.secondBookkeeper);
const CUSTOMER = defaultActor("customer", IDS.customer);
const EDITOR = defaultActor("editor", IDS.editor);

async function seedUser(actor: UserActor, email: string): Promise<void> {
  await db().insert(users).values({
    id: actor.userId,
    email,
    role: actor.role,
  });
}

function flow(
  rows: Awaited<ReturnType<typeof listGuidance.call>>,
  key: string,
) {
  const found = rows.find((row) => row.key === key);
  if (!found) throw new Error(`missing guidance flow ${key}`);
  return found;
}

const chronologyFixture=defineService({
 name:"guidance.chronologyFixture",summary:"Exercise real work and guide boundaries in one transaction.",kind:"mutation",permission:"authenticated",external:false,
 input:z.object({order:z.enum(["old-before-start","start-before-new","old-before-reset","start-before-submission"])}),output:z.object({key:z.string()}),
 handler:async(input,ctx)=>{
  const key=input.order==="start-before-submission"?"core.owner-first-win":"core.bookkeeper-first-win";
  const preference={topic:"forms.submission",channel:"in_app" as const,mode:"immediate" as const};
  if(input.order==="old-before-start" || input.order==="old-before-reset")await ctx.call(updateNotificationPreference,preference);
  await ctx.call(input.order==="old-before-reset"?resetGuidance:startGuidance,{flowKey:key});
  if(input.order==="start-before-new")await ctx.call(updateNotificationPreference,preference);
  if(input.order==="start-before-submission"){
   const form=await ctx.call(createForm,{slug:"composed-guidance-enquiry",name:"Composed enquiry",fields:[{key:"name",label:"Name",kind:"text",required:true},{key:"email",label:"Email",kind:"email",required:true}]});
   await ctx.call(submitForm,{slug:form.slug,values:{name:"Synthetic composed enquiry",email:"composed-guidance@example.test",[STAMP_FIELD]:issueStamp(new Date(Date.now()-20000))}});
  }
  return {key};
 },
});

describe.runIf(hasDatabase)("guidance progress", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("ignores old clicks, follows real work, resumes, resets and stays personal", async () => {
    await seedUser(BOOKKEEPER, "books@example.test");
    await seedUser(SECOND_BOOKKEEPER, "other-books@example.test");

    // Work done before this guide began is not falsely claimed as its win.
    await updateNotificationPreference.call(
      {
        topic: "forms.submission",
        channel: "in_app",
        mode: "immediate",
      },
      BOOKKEEPER,
    );
    await startGuidance.call(
      { flowKey: "core.bookkeeper-first-win" },
      BOOKKEEPER,
    );
    let current = flow(
      await listGuidance.call(
        { flowKey: "core.bookkeeper-first-win" },
        BOOKKEEPER,
      ),
      "core.bookkeeper-first-win",
    );
    expect(current).toMatchObject({
      state: "active",
      completedCount: 0,
      totalCount: 2,
    });

    await updateNotificationPreference.call(
      {
        topic: "forms.submission",
        channel: "in_app",
        mode: "off",
      },
      BOOKKEEPER,
    );
    current = flow(await listGuidance.call({}, BOOKKEEPER), current.key);
    expect(current).toMatchObject({ state: "active", completedCount: 1 });
    expect(current.steps.find((step) => step.key === "choose-alerts")?.completed)
      .toBe(true);

    await dismissGuidance.call({ flowKey: current.key }, BOOKKEEPER);
    current = flow(await listGuidance.call({}, BOOKKEEPER), current.key);
    expect(current.state).toBe("dismissed");
    await startGuidance.call({ flowKey: current.key }, BOOKKEEPER);
    expect(flow(await listGuidance.call({}, BOOKKEEPER), current.key).state)
      .toBe("active");

    await updateNotificationSettings.call(
      {
        digestCadence: "weekly",
        digestMinute: 510,
        digestWeekday: 5,
        timezone: "America/Vancouver",
        escalationMinutes: 30,
      },
      BOOKKEEPER,
    );
    current = flow(await listGuidance.call({}, BOOKKEEPER), current.key);
    expect(current).toMatchObject({
      state: "completed",
      completedCount: 2,
      totalCount: 2,
    });
    expect(current.completedAt).toBeInstanceOf(Date);

    const [firstReconciliation] = await db()
      .select()
      .from(guidanceProgress)
      .where(eq(guidanceProgress.userId, BOOKKEEPER.userId));
    await listGuidance.call({}, BOOKKEEPER);
    const [secondReconciliation] = await db()
      .select()
      .from(guidanceProgress)
      .where(eq(guidanceProgress.userId, BOOKKEEPER.userId));
    expect(secondReconciliation?.updatedAt).toEqual(firstReconciliation?.updatedAt);

    expect(
      flow(await listGuidance.call({}, SECOND_BOOKKEEPER), current.key),
    ).toMatchObject({ state: "not_started", completedCount: 0 });

    await resetGuidance.call({ flowKey: current.key }, BOOKKEEPER);
    current = flow(await listGuidance.call({}, BOOKKEEPER), current.key);
    expect(current).toMatchObject({ state: "active", completedCount: 0 });
  });

  it("keeps the precise stored start boundary when old and new work share a millisecond",async()=>{
    await seedUser(BOOKKEEPER,"precise-guide@example.test");
    await updateNotificationPreference.call({topic:"forms.submission",channel:"in_app",mode:"immediate"},BOOKKEEPER);
    await startGuidance.call({flowKey:"core.bookkeeper-first-win"},BOOKKEEPER);
    await db().update(guidanceProgress).set({startedAt:sql`'2026-11-11 00:00:00.000700+00'::timestamptz`}).where(eq(guidanceProgress.userId,BOOKKEEPER.userId));
    await db().update(auditLog).set({at:sql`'2026-11-11 00:00:00.000300+00'::timestamptz`}).where(and(eq(auditLog.actor,`user:${BOOKKEEPER.userId}`),eq(auditLog.action,"notifications.updatePreference")));
    expect(flow(await listGuidance.call({},BOOKKEEPER),"core.bookkeeper-first-win").completedCount).toBe(0);
    await db().update(auditLog).set({at:sql`'2026-11-11 00:00:00.000900+00'::timestamptz`}).where(and(eq(auditLog.actor,`user:${BOOKKEEPER.userId}`),eq(auditLog.action,"notifications.updatePreference")));
    expect(flow(await listGuidance.call({},BOOKKEEPER),"core.bookkeeper-first-win").completedCount).toBe(1);
  });
  it.each(["old-before-start","start-before-new","old-before-reset"] as const)("preserves composed chronology: %s",async order=>{
    await seedUser(BOOKKEEPER,"composed-guide@example.test");
    const {key}=await chronologyFixture.call({order},BOOKKEEPER);
    expect(flow(await listGuidance.call({},BOOKKEEPER),key).completedCount).toBe(order==="start-before-new"?1:0);
  });
  it("counts a real submission after a composed guide start",async()=>{
    await seedUser(OWNER,"composed-owner@example.test");
    const {key}=await chronologyFixture.call({order:"start-before-submission"},OWNER);
    const current=flow(await listGuidance.call({},OWNER),key);
    expect(current.steps.find(step=>step.key==="capture-enquiry")?.completed).toBe(true);
  });

  it("reactivates a completed flow when a new capability exposes a task", async () => {
    await db().insert(roles).values({
      key: "site-writer",
      name: "Site writer",
      description: "A deliberately narrow custom role.",
    });
    await db().insert(roleGrants).values([
      { roleKey: "site-writer", module: "admin", access: "view" },
      { roleKey: "site-writer", module: "cms", access: "manage" },
    ]);
    const narrow: UserActor = {
      kind: "user",
      userId: IDS.custom,
      role: "site-writer",
      grants: [
        { module: "admin", access: "view" },
        { module: "cms", access: "manage" },
      ],
    };
    await seedUser(narrow, "writer@example.test");
    await startGuidance.call({ flowKey: "core.editor-first-win" }, narrow);
    await db().insert(auditLog).values({
      actor: `user:${narrow.userId}`,
      action: "cms.publishPage",
      diff: {},
    });
    expect(flow(await listGuidance.call({}, narrow), "core.editor-first-win"))
      .toMatchObject({ state: "completed", completedCount: 1, totalCount: 1 });

    const expanded: UserActor = {
      ...narrow,
      grants: [...narrow.grants, { module: "media", access: "manage" }],
    };
    const reappeared = flow(
      await listGuidance.call({}, expanded),
      "core.editor-first-win",
    );
    expect(reappeared).toMatchObject({
      state: "active",
      completedCount: 1,
      totalCount: 2,
    });
    expect(reappeared.steps.map((step) => step.key)).toEqual([
      "publish-page",
      "upload-media",
    ]);
  });

  it("counts a captured enquiry only after an owner starts the guide", async () => {
    await seedUser(OWNER, "owner-guidance@example.test");
    await startGuidance.call({ flowKey: "core.owner-first-win" }, OWNER);
    await createForm.call(
      {
        slug: "guided-enquiry",
        name: "Guided enquiry",
        fields: [
          { key: "name", label: "Name", kind: "text", required: true },
          { key: "email", label: "Email", kind: "email", required: true },
        ],
      },
      OWNER,
    );
    await submitForm.call(
      {
        slug: "guided-enquiry",
        values: {
          name: "First customer",
          email: "first-customer@example.test",
          [STAMP_FIELD]: issueStamp(new Date(Date.now() - 20_000)),
        },
        sourceUrl: "/contact",
      },
      { kind: "anonymous" },
    );
    const ownerFlow = flow(
      await listGuidance.call({}, OWNER),
      "core.owner-first-win",
    );
    expect(
      ownerFlow.steps.find((step) => step.key === "capture-enquiry")?.completed,
    ).toBe(true);
    expect(ownerFlow.completedCount).toBe(1);
  });

  it("recognizes a linked customer and completes a real privacy preference", async () => {
    await seedUser(CUSTOMER, "portal-guidance@example.test");
    await db().insert(contacts).values({
      userId: CUSTOMER.userId,
      name: "Portal customer",
      email: "portal-guidance@example.test",
    });
    await startGuidance.call({ flowKey: "core.customer-first-win" }, CUSTOMER);
    let customerFlow = flow(
      await listGuidance.call({}, CUSTOMER),
      "core.customer-first-win",
    );
    expect(customerFlow).toMatchObject({ state: "active", completedCount: 1 });
    await setMyMarketingPreference.call(
      {
        channel: "email",
        state: "withdrawn",
        termsVersion: "guidance-test-v1",
      },
      CUSTOMER,
    );
    customerFlow = flow(await listGuidance.call({}, CUSTOMER), customerFlow.key);
    expect(customerFlow).toMatchObject({
      state: "completed",
      completedCount: 2,
      totalCount: 2,
    });
  });

  it("refuses unavailable flows without exposing another user's progress", async () => {
    await seedUser(EDITOR, "editor-guidance@example.test");
    await seedUser(BOOKKEEPER, "books-guidance@example.test");
    expect(
      (await failure(
        startGuidance.call({ flowKey: "core.owner-first-win" }, EDITOR),
      )).code,
    ).toBe("permission");
    expect(
      (await failure(listGuidance.call({}, { kind: "anonymous" }))).code,
    ).toBe("permission");

    await startGuidance.call(
      { flowKey: "core.bookkeeper-first-win" },
      BOOKKEEPER,
    );
    expect(await db().select().from(guidanceProgress).where(and(
      eq(guidanceProgress.userId, EDITOR.userId),
      eq(guidanceProgress.flowKey, "core.bookkeeper-first-win"),
    ))).toHaveLength(0);
    expect((await listGuidance.call({}, EDITOR)).map((item) => item.key)).toEqual([
      "core.editor-first-win",
    ]);
  });
});
