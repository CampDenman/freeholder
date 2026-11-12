// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A fixture declares its original person; an email match is never that choice.
import { expect } from "vitest";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { readerOwnershipReview, resolveReaderOwnership } from "@/core/import/reader-ownership-review";
import { OWNER } from "./spine";

export async function freshlyVerifiedImportOwner() {
  await db().insert(users).values({ id: OWNER.userId, email: "fictional-import-reviewer@example.test", role: "owner" }).onConflictDoNothing();
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-import-review-factor" }).onConflictDoNothing();
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId || !actor.security?.stepUpValid) throw new Error("The fixture did not resolve a freshly verified human owner.");
  return actor;
}

export async function reviewOriginalImportedReader(input: { id: string; postId: string; commentId: string; contactId: string }) {
  const actor = await freshlyVerifiedImportOwner();
  const review = await readerOwnershipReview.call({ id: input.id, limit: 50 }, actor);
  const row = review.rows.find(row => row.postId === input.postId && row.commentId === input.commentId);
  expect(row).toBeDefined();
  await resolveReaderOwnership.call({ ...input, receiptId: row!.receiptId, confirmation: "ASSIGN ORIGINAL READER" }, actor);
  return actor;
}
