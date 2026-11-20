// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.38: rejected content must leave recoverable physical evidence without masking validation.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { desc } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { uploadAsset } from "@/core/media/service";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { reconcileOriginalSourceErasure } from "@/core/import/source-erasure-history";
import { reconcileCrawlOriginalObservation } from "@/core/import/crawl-privacy";
import { reconcileStorageTransferErasure } from "@/core/media/transfer-privacy";
import { closeDb, CUSTOMER, failure, hasDatabase, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("rejected upload observation recovery", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: CUSTOMER.userId, email: "rae@example.test", role: "customer" });
  });
  afterAll(closeDb);

  it("keeps the content refusal and reconciles every dependent domain", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer());
    const refused = await failure(uploadAsset.call({ filename: "disguised.wav", contentType: "audio/wav", bytes: png, provenance: { purpose: "form" } }, CUSTOMER));
    expect(refused.code).toBe("validation");
    await expect(uploadAsset.call({ filename: "honest.png", contentType: "image/png", bytes: png, provenance: { purpose: "form" } }, CUSTOMER)).resolves.toMatchObject({ kind: "image" });
    const [receipt] = await db().select().from(mediaObjectWrites).orderBy(desc(mediaObjectWrites.createdAt)).limit(1);
    expect(receipt).toBeTruthy();
    for (const service of [reconcileOriginalSourceErasure, reconcileCrawlOriginalObservation, reconcileStorageTransferErasure]) {
      await expect(service.call({ receiptId: receipt!.id }, { kind: "system" })).resolves.toBeDefined();
    }
    const writes = await db().select().from(mediaObjectWrites).orderBy(desc(mediaObjectWrites.createdAt));
    for (const write of writes) {
      await expect((await import("@/core/media/original-quota-evidence")).reconcileActualOriginalQuota(write.id)).resolves.toBe(true);
      await expect((await import("@/core/media/erasure-cohorts")).reconcileMediaErasureCohorts({ objectReceiptId: write.id })).resolves.toBeUndefined();
    }
  });
});
