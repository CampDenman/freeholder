// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: canonical capture receipts must survive stale and partial writers.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { createContact } from "@/core/contacts/service";
import { db } from "@/core/db";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { completeRetentionSourceSnapshot, hasUnknownRetentionSourceHold, retentionSourceMemberIsHeld, retentionSourceSnapshotIsComplete } from "@/core/privacy/retention-snapshots";
import { addRetentionException, createDataRequest, registerContactPrivacySource, removeRetentionException } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("canonical original retention integrity", () => {
  const scope = "tests.canonicalRetention";
  let mode: "normal" | "partial" | "legacy" = "normal";
  let members: { sourceId: string; generation: string }[] = [];
  beforeAll(async () => {
    await ready();
    registerContactPrivacySource({
      scope, tables: [], exportData: async () => [], erase: async () => ({ affected: 0 }),
      captureRetention: async (tx, _contactId, context) => {
        if (mode === "legacy") return;
        if (mode === "partial") {
          // A deliberately incomplete source callback still uses the genuine
          // parent transaction. The deferred SQL constraint must abort its hold.
          await tx.execute(sql`select set_config('freeholder.retention_snapshot_v1','1',true)`);
          await tx.insert(privacyRetentionSourceSnapshots).values({ exceptionId: context.exceptionId, sourceScope: scope, memberCount: 1 });
          return;
        }
        await completeRetentionSourceSnapshot(context.service, { ...context, sourceScope: scope, members });
      },
    });
  }, 60_000);
  beforeEach(async () => {
    mode = "normal";
    members = [{ sourceId: randomUUID(), generation: randomUUID() }, { sourceId: randomUUID(), generation: randomUUID() }];
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "canonical-owner@example.test", role: "owner" });
  });
  afterAll(closeDb);

  async function pending() {
    const contact = await createContact.call({ name: "Held original source", email: "canonical-subject@example.test" }, OWNER);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    return { request, input: { dataRequestId: request.id, scope, reason: "legal_obligation" as const, legalBasis: "Preserve the exact original source generation for review." } };
  }
  const headers = () => db().select().from(privacyRetentionSourceSnapshots);
  const captured = () => db().select().from(privacyRetentionSourceMembers).orderBy(privacyRetentionSourceMembers.sourceId);
  async function sqlRefusal(operation: PromiseLike<unknown>) {
    let caught: unknown;
    try { await operation; } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    const codes: unknown[] = [];
    for (let error = caught as { code?: unknown; cause?: unknown } | undefined; error; error = error.cause as typeof error) codes.push(error.code);
    expect(codes).toContain("55000");
  }

  it("captures the original membership once and keeps renewal from adopting a later generation", async () => {
    const { input } = await pending();
    const original = [...members];
    const hold = await addRetentionException.call(input, OWNER);
    const before = await captured();
    expect(before).toHaveLength(2);
    expect(await retentionSourceSnapshotIsComplete(db(), hold.id, scope)).toBe(true);
    members = [{ sourceId: original[0]!.sourceId, generation: randomUUID() }];
    await addRetentionException.call({ ...input, legalBasis: "Continue the same original retention obligation." }, OWNER);
    expect(await captured()).toEqual(before);
    expect(await retentionSourceMemberIsHeld(db(), scope, original[0]!.sourceId, original[0]!.generation, [scope])).toBe(true);
    expect(await retentionSourceMemberIsHeld(db(), scope, members[0]!.sourceId, members[0]!.generation, [scope])).toBe(false);
    expect(await hasUnknownRetentionSourceHold(db(), scope, [scope])).toBe(false);
  });

  it("refuses incomplete captures atomically at the actual parent transaction commit", async () => {
    const { input, request } = await pending();
    mode = "partial";
    await sqlRefusal(addRetentionException.call(input, OWNER));
    expect(await db().select().from(privacyRetentionExceptions)).toHaveLength(0);
    expect(await headers()).toHaveLength(0);
    expect(await captured()).toHaveLength(0);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("submitted");
  });

  it("refuses stale inserts, late expansion, receipt edits and receipt deletion while its real hold exists", async () => {
    const { input } = await pending();
    const hold = await addRetentionException.call(input, OWNER);
    const beforeHeaders = await headers(), beforeMembers = await captured();
    const extra = { exceptionId: hold.id, sourceScope: scope, sourceId: randomUUID(), generation: randomUUID() };
    await sqlRefusal(db().insert(privacyRetentionSourceMembers).values(extra));
    await sqlRefusal(db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.retention_snapshot_v1','1',true)`);
      await tx.insert(privacyRetentionSourceMembers).values(extra);
    }));
    await sqlRefusal(db().update(privacyRetentionSourceSnapshots).set({ memberCount: 0 }).where(eq(privacyRetentionSourceSnapshots.exceptionId, hold.id)));
    await sqlRefusal(db().update(privacyRetentionSourceMembers).set({ generation: randomUUID() }).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id)));
    await sqlRefusal(db().delete(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id)));
    await sqlRefusal(db().delete(privacyRetentionSourceSnapshots).where(eq(privacyRetentionSourceSnapshots.exceptionId, hold.id)));
    expect(await headers()).toEqual(beforeHeaders);
    expect(await captured()).toEqual(beforeMembers);
  });

  it("keeps an unknown historical hold unknown instead of backfilling an empty renewal", async () => {
    const { input } = await pending();
    mode = "legacy";
    const hold = await addRetentionException.call(input, OWNER);
    expect(await hasUnknownRetentionSourceHold(db(), scope, [scope])).toBe(true);
    mode = "normal";
    members = [];
    await expect(addRetentionException.call({ ...input, legalBasis: "A renewal must not infer an empty original capture." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await headers()).toHaveLength(0);
    expect(await captured()).toHaveLength(0);
    expect((await db().select().from(privacyRetentionExceptions))[0]).toEqual(hold);
  });

  it("distinguishes an actual empty capture and releases receipts only with the real parent hold", async () => {
    const { input, request } = await pending();
    members = [];
    const hold = await addRetentionException.call(input, OWNER);
    expect((await headers())[0]).toMatchObject({ exceptionId: hold.id, sourceScope: scope, memberCount: 0 });
    expect(await retentionSourceSnapshotIsComplete(db(), hold.id, scope)).toBe(true);
    expect(await hasUnknownRetentionSourceHold(db(), scope, [scope])).toBe(false);
    await removeRetentionException.call({ id: hold.id }, OWNER);
    expect(await headers()).toHaveLength(0);
    expect(await captured()).toHaveLength(0);
    expect(await db().select().from(dataRequests).where(eq(dataRequests.id, request.id))).toHaveLength(1);
    members = [{ sourceId: randomUUID(), generation: randomUUID() }];
    const replacement = await addRetentionException.call(input, OWNER);
    expect(replacement.id).not.toBe(hold.id);
    expect(await captured()).toHaveLength(1);
    await removeRetentionException.call({ id: replacement.id }, OWNER);
    expect(await headers()).toHaveLength(0);
    expect(await captured()).toHaveLength(0);
  });
});
