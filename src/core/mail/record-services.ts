// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: legacy attribution requires the original person's explicit review.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { timestamp } from "@/core/contract";
import { defineService, getService, ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { mailDeliveries, mailProviderEvents, mailRecordSubjects, mailSuppressions } from "./schema";
import { lockMailRecord } from "./ownership";
import { mailReceipts } from "./receipts";

const kind = z.enum(["delivery", "event", "suppression"]);
const address = z.string().trim().email().toLowerCase().max(320);
const legacyRow = z.object({ kind, id: z.uuid(), recipient: z.string(), subject: z.string(), state: z.string(), createdAt: timestamp });
export const listLegacyMailRecords = defineService({
  name: "mail.listLegacyRecords", summary: "Review mail whose historical contact ownership is not yet established.", kind: "query", permission: "scoped",
  input: z.object({ recipient: address.optional(), limit: z.number().int().min(1).max(100).default(25) }),
  output: z.object({ rows: z.array(legacyRow) }),
  handler: async (input, ctx) => {
    const rows: Array<z.infer<typeof legacyRow>> = [];
    for (const record of ["delivery", "event", "suppression"] as const) {
      const table = record === "delivery" ? mailDeliveries : record === "event" ? mailProviderEvents : mailSuppressions;
      const recipient = record === "suppression" ? mailSuppressions.email : record === "event" ? mailProviderEvents.recipient : mailDeliveries.recipient;
      const subject = record === "delivery" ? mailDeliveries.subject : sql`''::text`;
      const state = record === "delivery" ? mailDeliveries.status : record === "event" ? mailProviderEvents.eventType : sql`case when ${mailSuppressions.active} then 'active' else 'released' end`;
      const source = await ctx.tx.execute<{ id: string; recipient: string; subject: string; state: string; createdAt: string }>(sql`
       select ${table.id} as id,${recipient} as recipient,${subject} as subject,${state} as state,${table.createdAt} as "createdAt"
       from ${table} where ${table.redactedAt} is null
        and not exists(select 1 from ${mailRecordSubjects} where kind=${record} and record_id=${table.id} and contact_id is not null)
        ${input.recipient ? sql`and ${recipient}=${input.recipient}` : sql``}
       order by ${table.createdAt} desc,${table.id} limit ${input.limit}`);
      rows.push(...source.map(row => ({ ...row, createdAt: new Date(row.createdAt), kind: record })));
    }
    rows.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || left.id.localeCompare(right.id));
    return { rows: rows.slice(0, input.limit) };
  },
});

export const reviewLegacyMailOwnership = defineService({
  name: "mail.reviewLegacyOwnership", summary: "Record verified ownership of one unchanged legacy mail record.", kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false,
  input: z.object({ kind, id: z.uuid(), expectedRecipient: address, contactId: z.uuid(), evidence: z.string().trim().min(20).max(4_000), confirmation: z.literal("VERIFIED") }),
  auditInputFields: ["kind", "id"],
  output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const contact = z.object({ id: z.uuid() }).nullable().parse(await ctx.call(getService("contacts.get"), { id: input.contactId }));
    if (!contact) throw new ServiceError("not_found", "That contact is not here.");
    const receipts = await mailReceipts(ctx.tx), row = await lockMailRecord(ctx.tx, input.kind, input.id);
    if (!row || row.redactedAt || row.email !== input.expectedRecipient) throw new ServiceError("conflict", "This mail record changed. Reload it and verify the original ownership before retrying.");
    const [bound] = await ctx.tx.select({ id: mailRecordSubjects.id }).from(mailRecordSubjects).where(and(eq(mailRecordSubjects.kind, input.kind), eq(mailRecordSubjects.recordId, input.id), isNotNull(mailRecordSubjects.contactId))).limit(1);
    if (bound) throw new ServiceError("conflict", "This record already has established ownership. Review that history instead of assigning another person.");
    await ctx.tx.insert(mailRecordSubjects).values({ kind: input.kind, recordId: input.id, contactId: input.contactId, basis: "owner_review", verifiedBy: ctx.actor.kind === "user" ? ctx.actor.userId : null, evidenceDigest: receipts.digest("ownership-evidence", JSON.stringify({ kind: input.kind, id: input.id, recipient: input.expectedRecipient, contactId: input.contactId, evidence: input.evidence, actor: ctx.actor.kind === "user" ? ctx.actor.userId : ctx.actor.kind })) });
    ctx.setSubject("mail_record", input.id);
    return { ok: true as const };
  },
});
export default [listLegacyMailRecords, reviewLegacyMailOwnership];
