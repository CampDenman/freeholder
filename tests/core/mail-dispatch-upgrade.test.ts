// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: old guarded images must not append new mail after the upgrade.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { mailReceipts } from "@/core/mail/receipts";
import { mailDeliveries, mailRecordSubjects } from "@/core/mail/schema";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const migration = readFileSync("db/migrations/0072_mail_physical_dispatches.sql", "utf8");
async function oldWriterRefused(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ cause: { code: "23514", message: "Mail physical dispatch requires the current guarded writer" } });
}
describe.runIf(hasDatabase)("mail physical-dispatch upgrade (C3.31/C11.08)", () => {
  beforeEach(truncateSpine); afterAll(closeDb);
  it("refuses a prior image's mail intake even when it has the old privacy capability", async () => {
    await oldWriterRefused(db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.mail_receipts_v1','1',true)`);
      await tx.execute(sql`select set_config('freeholder.mail_dispatch_v1','0',true)`);
      await tx.execute(sql`insert into mail_deliveries(purpose,provider,recipient,recipient_digest,subject,requested_by) values('transactional','smtp','fictional@example.test',${"e".repeat(64)},'Old image late intake','system')`);
    }));
  });
  it("allows an empty contact FK cleanup while refusing an old nonempty ownership rewrite", async () => {
    const [unrelated, original, replacement] = await db().insert(contacts).values(["unrelated", "original", "replacement"].map(name => ({ name, email: `${name}@example.test` }))).returning();
    await expect(db().delete(contacts).where(sql`${contacts.id}=${unrelated!.id}`)).resolves.toBeDefined();
    const pointer = await db().transaction(async tx => {
      const receipts = await mailReceipts(tx);
      const [delivery] = await tx.insert(mailDeliveries).values({ purpose: "transactional", provider: "smtp", recipient: "original@example.test", recipientDigest: receipts.digest("address", "original@example.test"), subject: "Fictional original ownership", requestedBy: "system" }).returning();
      const [owned] = await tx.insert(mailRecordSubjects).values({ kind: "delivery", recordId: delivery!.id, contactId: original!.id }).returning();
      return owned!;
    });
    await oldWriterRefused(db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.mail_receipts_v1','1',true)`);
      await tx.execute(sql`select set_config('freeholder.mail_dispatch_v1','0',true)`);
      await tx.execute(sql`update mail_record_subjects set contact_id=${replacement!.id} where id=${pointer.id}`);
    }));
    expect((await db().select().from(mailRecordSubjects))[0]?.contactId).toBe(original!.id);
  });
  it("preserves populated old unknown sends and keeps every old claim or cleanup writer read-only", async () => {
    const rollback = new Error("rollback synthetic schema71 upgrade");
    await expect(db().transaction(async tx => {
      await tx.execute(sql.raw("drop function freeholder_mail_dispatch_admission() cascade; drop function freeholder_mail_dispatch_writer() cascade; drop function freeholder_mail_dispatch_metadata() cascade; drop table mail_dispatches,mail_dispatch_requests,mail_legacy_resolutions;"));
      await tx.execute(sql`select set_config('freeholder.mail_receipts_v1','0',true)`);
      await tx.execute(sql`select set_config('freeholder.mail_dispatch_v1','0',true)`);
      const deliveryId = randomUUID();
      await tx.execute(sql`insert into mail_deliveries(id,purpose,provider,recipient,subject,status,attempts,provider_ref,requested_by) values(${deliveryId},'transactional','smtp','fictional@example.test','Original old private subject','submitted',3,'only-original-legacy-reference','system')`);
      await tx.execute(sql`insert into mail_outbox(delivery_id,encrypted_message) values(${deliveryId},'synthetic-original-encrypted-body')`);
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
      await tx.execute(sql`select set_config('freeholder.mail_receipts_v1','1',true)`);
      const [delivery] = await tx.execute<{ recipient: string; attempts: number; provider_ref: string }>(sql`select recipient,attempts,provider_ref from mail_deliveries where id=${deliveryId}`);
      expect(delivery).toEqual({ recipient: "fictional@example.test", attempts: 3, provider_ref: "only-original-legacy-reference" });
      expect(await tx.execute(sql`select 1 from mail_dispatch_requests`)).toHaveLength(0);
      expect(await tx.execute(sql`select 1 from mail_dispatches`)).toHaveLength(0);
      expect(await tx.execute(sql`select 1 from mail_legacy_resolutions`)).toHaveLength(0);
      await oldWriterRefused(tx.transaction(inner => inner.execute(sql`update mail_deliveries set attempts=attempts+1 where id=${deliveryId}`)));
      await oldWriterRefused(tx.transaction(inner => inner.execute(sql`delete from mail_outbox where delivery_id=${deliveryId}`)));
      expect(await tx.execute(sql`select encrypted_message from mail_outbox where delivery_id=${deliveryId}`)).toEqual([{ encrypted_message: "synthetic-original-encrypted-body" }]);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
