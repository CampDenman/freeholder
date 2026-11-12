// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: actual prior-runtime committed data must not become mailbox proof.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { customerMagicLinks } from "@/core/contacts/schema";
import { consumeCustomerMagicLink } from "@/core/auth/magic-links/service";
import { hashCustomerMagicLinkToken } from "@/core/auth/two-factor-crypto";
import { actorFromToken } from "@/core/http/actor";
import { createMyDataRequest, fulfillDataRequest, downloadMyDataRequestArtifact } from "@/core/privacy/service";
import { readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { ANONYMOUS, closeDb } from "../helpers/spine";
import { freshlyVerifiedImportOwner } from "../helpers/import-reader-review";
import { READER_UPGRADE_EMAIL, READER_UPGRADE_BODY } from "./import-reader-data";

afterAll(async () => { await stopJobs(); await closeDb(); });
it("does not disclose actual pre78 private imported history through only current mailbox proof", async () => {
  const fixture = JSON.parse(readFileSync(process.env.FREEHOLDER_READER_UPGRADE_EVIDENCE!, "utf8")) as { originalId: string };
  expect(await db().select().from(readerOwnershipReceipts)).toHaveLength(0);
  expect((await db().select().from(blogReaderComments).where(eq(blogReaderComments.contactId, fixture.originalId)))[0]).toMatchObject({ body: READER_UPGRADE_BODY, status: "pending" });
  const owner = await freshlyVerifiedImportOwner();
  const token = randomBytes(32).toString("base64url");
  await db().insert(customerMagicLinks).values({ contactId: fixture.originalId, email: READER_UPGRADE_EMAIL, tokenHash: hashCustomerMagicLinkToken(token), expiresAt: new Date(Date.now() + 60_000) });
  const session = await consumeCustomerMagicLink.call({ token }, ANONYMOUS);
  const holder = await actorFromToken(session.token);
  const request = await createMyDataRequest.call({ request: { kind: "export" } }, holder);
  const result = await fulfillDataRequest.call({ id: request.id }, owner);
  expect((await downloadMyDataRequestArtifact.call({ id: result.artifact.id }, holder)).content).not.toContain(READER_UPGRADE_BODY);
});
