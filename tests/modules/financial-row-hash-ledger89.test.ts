// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C11.05: real source-row maintenance and fail-closed fingerprint reads.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/core/db";
import { merchantTaxProfiles, merchantTaxProfileVersions } from "@/modules/invoicing/merchant-tax-schema";

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDatabase)("financial row hash ledger", () => {
  afterAll(closeDb);

  it("preserves exact fingerprints across insert and update", async () => {
    const profileId = randomUUID();
    const rollback = new Error("Roll back the financial row-hash fixture");
    await expect(db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.merchant_tax_writes_v1','1',true)`);
      await tx.insert(merchantTaxProfiles).values({ id: profileId, sellerKey: "site" });
      const current = async () => {
        const [row] = await tx.execute<{
          stored: string;
          expected: string;
          storedBytes: number;
          expectedBytes: number;
          fingerprint: string;
        }>(sql`
          select h.row_sha256 as stored,
            encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') as expected,
            h.row_bytes::int as "storedBytes",octet_length(to_jsonb(p)::text) as "expectedBytes",
            freeholder_financial_row_fingerprint('merchant_tax_profiles',p.id) as fingerprint
          from merchant_tax_profiles p
          join financial_row_hashes h on h.table_name='merchant_tax_profiles' and h.row_id=p.id
          where p.id=${profileId}::uuid`);
        expect(row).toBeDefined();
        expect(row).toMatchObject({ stored: row!.expected, storedBytes: row!.expectedBytes, fingerprint: row!.expected });
        return row!;
      };
      const inserted = await current();
      await tx.insert(merchantTaxProfileVersions).values({
        profileId, version: 1, requestKey: randomUUID(), liability: "platform", origin: { country: "CA" },
        collectionStatus: "registered", rulesSnapshot: [], declarationDigest: "0".repeat(64),
        merchantName: "Fixture business",
        merchantSupport: { email: null, phone: null, url: "https://example.com", address: null },
      });
      await tx.update(merchantTaxProfiles).set({ currentVersion: 1 }).where(eq(merchantTaxProfiles.id, profileId));
      const updated = await current();
      expect(updated.stored).not.toBe(inserted.stored);
      throw rollback;
    })).rejects.toBe(rollback);
    const [remaining] = await db().execute<{ count: number }>(sql`
      select count(*)::int as count from financial_row_hashes
      where table_name='merchant_tax_profiles' and row_id=${profileId}::uuid`);
    expect(remaining?.count).toBe(0);
    await expect(db().execute(sql`
      select freeholder_financial_row_fingerprint('merchant_tax_profiles',${profileId}::uuid)`))
      .rejects.toSatisfy((error: unknown) => error instanceof Error && error.cause instanceof Error && error.cause.message.includes("Missing financial row fingerprint"));
    await expect(db().execute(sql`
      insert into financial_row_hashes(table_name,row_id,row_sha256,row_bytes)
      values('merchant_tax_profiles',${profileId}::uuid,${"0".repeat(64)},1)`)).rejects.toThrow();
  });
});
