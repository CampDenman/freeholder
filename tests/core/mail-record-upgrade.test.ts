// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: populated N-1 shape, no guessed owners, guarded irreversible writes.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const migration = readFileSync("db/migrations/0071_mail_record_retention.sql", "utf8");
describe.runIf(hasDatabase)("populated mail record upgrade (C3.31)", () => {
  beforeEach(truncateSpine); afterAll(closeDb);
  it("preserves old active blocks and unresolved evidence without inferring historical ownership", async () => {
    const rollback = new Error("rollback synthetic N-1 upgrade fixture");
    await expect(db().transaction(async tx => {
      await tx.execute(sql.raw("drop function freeholder_mail_dispatch_admission() cascade; drop function freeholder_mail_dispatch_writer() cascade; drop function freeholder_mail_dispatch_metadata() cascade; drop table mail_dispatches,mail_dispatch_requests,mail_legacy_resolutions;"));
      for (const [trigger, table] of [
        ["mail_deliveries_receipt_writer", "mail_deliveries"], ["mail_provider_events_receipt_writer", "mail_provider_events"],
        ["mail_suppressions_receipt_writer", "mail_suppressions"], ["mail_outbox_receipt_writer", "mail_outbox"],
        ["mail_record_subjects_receipt_writer", "mail_record_subjects"], ["mail_retention_hold_writer", "privacy_retention_exceptions"],
        ["mail_deliveries_receipt_admission", "mail_deliveries"], ["mail_provider_events_receipt_admission", "mail_provider_events"],
        ["mail_suppressions_receipt_admission", "mail_suppressions"], ["mail_outbox_receipt_admission", "mail_outbox"],
        ["mail_deliveries_receipt_update_admission", "mail_deliveries"], ["mail_provider_events_receipt_update_admission", "mail_provider_events"],
        ["mail_suppressions_receipt_update_admission", "mail_suppressions"], ["mail_outbox_receipt_update_admission", "mail_outbox"],
      ]) await tx.execute(sql.raw(`drop trigger ${trigger} on ${table}`));
      await tx.execute(sql.raw("drop function freeholder_mail_receipt_writer(); drop function freeholder_mail_receipt_admission(); drop function freeholder_mail_hold_writer(); drop table mail_record_subjects; drop table mail_receipt_keys;"));
      await tx.execute(sql.raw("alter table mail_deliveries drop column recipient_digest,drop column idempotency_digest,drop column provider_ref_digest,drop column redacted_at; alter table mail_provider_events drop column recipient_digest,drop column external_event_digest,drop column provider_ref_digest,drop column redacted_at; alter table mail_suppressions drop column id,drop column email_digest,drop column redacted_at;"));
      const delivery = randomUUID(), event = randomUUID(), address = "legacy-upgrade@example.test";
      await tx.execute(sql`insert into mail_deliveries(id,purpose,provider,recipient,subject,status,requested_by,attempts,provider_ref) values(${delivery},'bulk','resend',${address},'Original private subject','bounced','system',2,'original-physical-reference')`);
      await tx.execute(sql`insert into mail_provider_events(id,provider,external_event_id,provider_ref,recipient,event_type,detail,raw_digest,delivery_id,occurred_at) values(${event},'resend','original-external-event','original-physical-reference',${address},'hard_bounce','Original private evidence',${"a".repeat(64)},${delivery},clock_timestamp())`);
      await tx.execute(sql`insert into mail_suppressions(email,reason,provider,active,source_event_id) values(${address},'hard_bounce','resend',true,${event})`);
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
      const [oldDelivery] = await tx.execute<{ recipient: string; provider_ref: string; attempts: number; recipient_digest: string | null }>(sql`select recipient,provider_ref,attempts,recipient_digest from mail_deliveries where id=${delivery}`);
      expect(oldDelivery).toMatchObject({ recipient: address, provider_ref: "original-physical-reference", attempts: 2, recipient_digest: null });
      const [block] = await tx.execute<{ id: string; email: string; active: boolean }>(sql`select id,email,active from mail_suppressions`);
      expect(block).toMatchObject({ email: address, active: true }); expect(block?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await tx.execute(sql`select 1 from mail_record_subjects`)).toHaveLength(0);
      await tx.execute(sql`insert into mail_receipt_keys(id,encrypted_key,wrapping_fingerprint,sealed_at) values(1,'synthetic-upgrade-envelope','synthetic-fingerprint',clock_timestamp())`);
      await expect(tx.transaction(inner => inner.execute(sql`update mail_suppressions set active=false,released_at=clock_timestamp() where email=${address}`))).rejects.toThrow();
      throw rollback;
    })).rejects.toBe(rollback);
    // All destructive fixture DDL and fake legacy data were rolled back.
    expect(await db().execute(sql`select 1 from mail_record_subjects`)).toHaveLength(0);
  });
});
