// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Current normal-journal runtime recovers the actual prior runtime's data.
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { importRuns } from "@/core/plugins/schema";
import { readerOwnershipKeys, readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { readerOwnershipReview, resolveReaderOwnership } from "@/core/import/reader-ownership-review";
import { commitImport } from "@/core/import/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { OWNER, closeDb } from "../helpers/spine";
import { READER_UPGRADE_BODY } from "./import-reader-data";

afterAll(async () => { await stopJobs(); await closeDb(); });
it("keeps a legacy source unknown until a genuinely fresh owner chooses its original reader", async () => {
  const fixture = JSON.parse(readFileSync(process.env.FREEHOLDER_READER_UPGRADE_EVIDENCE!, "utf8")) as { id: string; originalId: string; candidateId: string; createdBy: string };
  expect(await db().select().from(readerOwnershipKeys)).toHaveLength(0);
  expect(await db().select().from(readerOwnershipReceipts)).toHaveLength(0);
  await db().insert(users).values({ id: OWNER.userId, email: "fictional-upgrade-reviewer@example.test", role: "owner" });
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-upgrade-factor" });
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const owner = await actorFromToken(session.token);
  if (owner.kind !== "user" || !owner.sessionId || !owner.security?.stepUpValid) throw new Error("The fixture did not resolve a fresh verified human session.");
  await expect(commitImport.call({ id: fixture.id }, owner)).rejects.toMatchObject({ code: "conflict" });
  expect(await db().select().from(readerOwnershipReceipts)).toHaveLength(0);
  const review = await readerOwnershipReview.call({ id: fixture.id }, owner);
  expect(review.rows).toHaveLength(1);
  expect(JSON.stringify(review)).not.toContain(fixture.originalId);
  expect(JSON.stringify(review)).not.toContain(fixture.candidateId);
  const row = review.rows[0]!;
  expect(row.receiptId).toBeNull();
  await resolveReaderOwnership.call({ id: fixture.id, receiptId: row.receiptId, postId: row.postId, commentId: row.commentId, contactId: fixture.originalId, confirmation: "ASSIGN ORIGINAL READER" }, owner);
  expect((await commitImport.call({ id: fixture.id }, owner)).status).toBe("committed");
  expect((await db().select().from(importRuns).where(eq(importRuns.id, fixture.id)))[0]?.createdBy).toBe(fixture.createdBy);
  const [receipt] = await db().select().from(readerOwnershipReceipts);
  expect(receipt).toMatchObject({ firstRunId: fixture.id, createdBy: `user:${OWNER.userId}`, contactId: fixture.originalId, state: "bound" });
  const [comment] = await db().select().from(blogReaderComments);
  expect(comment).toMatchObject({ contactId: fixture.originalId, body: READER_UPGRADE_BODY });
  expect(comment?.contactId).not.toBe(fixture.candidateId);
});
