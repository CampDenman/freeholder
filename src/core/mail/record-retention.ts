// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: expire personal fields, preserve minimal replay/withdrawal receipts.
import { and, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "@/core/db";
import { auditLog, outboxEvents } from "@/core/events/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { registerRetentionSource, RETENTION_PURGE_BATCH } from "@/core/retention/registry";
import type { Tx } from "@/core/service";
import { notifications, notificationDeliveries } from "@/core/notifications/schema";
import { translator } from "@/core/i18n";
import { mailDeliveries, mailOutbox, mailProviderEvents, mailRecordSubjects, mailSuppressions } from "./schema";
import { lockMailReceiptWrites, sealMailReceipts, type MailReceipts } from "./receipts";
import type { MailRecordKind } from "./ownership";

export const MAIL_RECORDS_SCOPE = "mail.records";
export type MailRecordRef = { kind: MailRecordKind; id: string };
type Row = { id: string; address: string; addressDigest: string | null; provider: string; sendKey: string | null; sendDigest: string | null; eventKey: string | null; eventDigest: string | null; ref: string | null; refDigest: string | null };

export async function lockMailHolds(tx: Tx): Promise<string[]> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('freeholder-mail-retention-holds-v1'))`);
  const holds = await tx.select({ contactId: dataRequests.contactId }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(
    eq(privacyRetentionExceptions.scope, MAIL_RECORDS_SCOPE), sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`,
  ));
  return [...new Set(holds.map(row => row.contactId))];
}
export function mailRecordIsUnheld(kind: MailRecordKind, id: SQLWrapper, held: string[]): SQL | undefined {
  if (!held.length) return undefined;
  // A legacy row with uncertain ownership cannot prove that it is outside a
  // named hold. Do not infer that an address belongs to today's contact.
  return sql`exists(select 1 from ${mailRecordSubjects} where kind=${kind} and record_id=${id} and contact_id is not null)
   and not exists(select 1 from ${mailRecordSubjects} where kind=${kind} and record_id=${id} and (contact_id is null or ${inArray(mailRecordSubjects.contactId, held)}))`;
}
const unheld = mailRecordIsUnheld;
const terminalDelivery = sql`${inArray(mailDeliveries.status, ["delivered", "bounced", "complained", "suppressed", "failed"])}
 and not exists(select 1 from ${mailOutbox} where ${mailOutbox.deliveryId}=${mailDeliveries.id})
 and (${mailDeliveries.attempts}=0 or (${mailDeliveries.attempts}=1 and exists(
   select 1 from ${mailProviderEvents} where ${mailProviderEvents.deliveryId}=${mailDeliveries.id}
    and ${inArray(mailProviderEvents.eventType, ["delivered", "hard_bounce", "complaint", "suppressed", "failed"])})))`;
function eligible(kind: MailRecordKind, privacy = false): SQL {
  if (kind === "delivery") return terminalDelivery;
  if (kind === "suppression") return privacy ? sql`true` : sql`${mailSuppressions.active}=false and ${mailSuppressions.releasedAt} is not null`;
  return sql`exists(select 1 from ${mailDeliveries} where ${mailDeliveries.id}=${mailProviderEvents.deliveryId} and ${terminalDelivery})
   or (${mailProviderEvents.deliveryId} is null and ${inArray(mailProviderEvents.eventType, ["delivered", "hard_bounce", "complaint", "suppressed", "failed"])}
    and not exists(select 1 from ${mailDeliveries} where
     (${mailDeliveries.recipient}=${mailProviderEvents.recipient} or (${mailProviderEvents.recipientDigest} is not null and ${mailDeliveries.recipientDigest}=${mailProviderEvents.recipientDigest}))
     and not (${terminalDelivery})))`;
}
function tableFor(kind: MailRecordKind) { return kind === "delivery" ? mailDeliveries : kind === "event" ? mailProviderEvents : mailSuppressions; }

async function candidates(tx: Tx, kind: MailRecordKind, held: string[], cutoff?: Date, ids?: string[], privacy = false): Promise<Row[]> {
  const table = tableFor(kind), clock = kind === "event" ? mailProviderEvents.createdAt : kind === "delivery" ? mailDeliveries.updatedAt : mailSuppressions.updatedAt;
  const where = and(isNull(table.redactedAt), eligible(kind, privacy), unheld(kind, table.id, held), cutoff ? sql`${clock}<${cutoff.toISOString()}::timestamptz` : undefined, ids ? inArray(table.id, ids) : undefined);
  const projection = kind === "delivery"
    ? sql`${mailDeliveries.id} as id,${mailDeliveries.recipient} as address,${mailDeliveries.recipientDigest} as "addressDigest",${mailDeliveries.provider} as provider,${mailDeliveries.idempotencyKey} as "sendKey",${mailDeliveries.idempotencyDigest} as "sendDigest",null::text as "eventKey",null::text as "eventDigest",${mailDeliveries.providerRef} as ref,${mailDeliveries.providerRefDigest} as "refDigest"`
    : kind === "event"
      ? sql`${mailProviderEvents.id} as id,${mailProviderEvents.recipient} as address,${mailProviderEvents.recipientDigest} as "addressDigest",${mailProviderEvents.provider} as provider,null::text as "sendKey",null::text as "sendDigest",${mailProviderEvents.externalEventId} as "eventKey",${mailProviderEvents.externalEventDigest} as "eventDigest",${mailProviderEvents.providerRef} as ref,${mailProviderEvents.providerRefDigest} as "refDigest"`
      : sql`${mailSuppressions.id} as id,${mailSuppressions.email} as address,${mailSuppressions.emailDigest} as "addressDigest",${mailSuppressions.provider} as provider,null::text as "sendKey",null::text as "sendDigest",null::text as "eventKey",null::text as "eventDigest",null::text as ref,null::text as "refDigest"`;
  return tx.execute<Row>(sql`select ${projection} from ${table} where ${where} order by ${table.id} limit ${RETENTION_PURGE_BATCH} for update skip locked`);
}
async function removeDerivedPersonalFields(tx: Tx, kind: MailRecordKind, ids: string[]): Promise<void> {
  if (kind === "event") await tx.update(auditLog).set({ diff: sql`${auditLog.diff}-'recipient'-'externalEventId'-'providerRef'-'detail'` }).where(and(eq(auditLog.action, "mail.recordProviderEvent"), eq(auditLog.subjectType, "mail_provider_event"), inArray(auditLog.subjectId, ids)));
  await tx.update(outboxEvents).set({ payload: sql`${outboxEvents.payload}-'recipient'` }).where(and(eq(outboxEvents.eventName, "mail.deliveryUpdated"), kind === "event" ? inArray(sql<string>`${outboxEvents.payload}->>'eventId'`, ids) : kind === "delivery" ? inArray(sql<string>`${outboxEvents.payload}->>'deliveryId'`, ids) : sql`false`));
}
/** Historical staff notices are app copies of the same provider fact. */
async function minimizeDerivedNotices(tx: Tx, kind: MailRecordKind, id: string, address: string, receipts: MailReceipts): Promise<boolean> {
  if (kind === "suppression") return false;
  const events = await tx.select({ id: outboxEvents.id, payload: outboxEvents.payload }).from(outboxEvents).where(and(eq(outboxEvents.eventName, "mail.deliveryUpdated"), eq(sql<string>`${outboxEvents.payload}->>${kind === "event" ? "eventId" : "deliveryId"}`, id)));
  if (!events.length) return false;
  const rows = await tx.select().from(notifications).where(and(eq(notifications.sourceEventName, "mail.deliveryUpdated"), inArray(notifications.sourceEventId, events.map(row => row.id)))).orderBy(notifications.id).for("update");
  if (!rows.length) return false;
  let pending = false;
  const containsAddress = (value: string | null) => Boolean(value?.toLowerCase().includes(address.toLowerCase()));
  for (const notice of rows) {
    const event = events.find(row => row.id === notice.sourceEventId), payload = event?.payload as Record<string, unknown> | undefined;
    await tx.update(notifications).set({ body: translator(notice.locale)("notifications.event.mail.body", { type: typeof payload?.type === "string" ? payload.type : "other" }), ...(containsAddress(notice.title) ? { title: translator(notice.locale)("notifications.event.mail.title") } : {}), dedupeKey: `mail:retained:${notice.id}` }).where(eq(notifications.id, notice.id));
    const attempts = await tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, notice.id)).orderBy(notificationDeliveries.id).for("update");
    for (const attempt of attempts) {
      let attemptPending = false;
      // A worker with an old rendered snapshot may still finish provider I/O.
      // Clock expiry and a later successful retry do not settle every attempt.
      if (attempt.status === "processing" || attempt.attempts > 1 || (attempt.attempts > 0 && !["delivered", "skipped"].includes(attempt.status))) attemptPending = true;
      const sendKeys = [`notification-delivery:${attempt.id}`, `notification-escalation:${notice.id}`, ...(attempt.digestId ? [`notification-digest:${attempt.digestId}`] : [])];
      const copies = await tx.select().from(mailDeliveries).where(or(inArray(mailDeliveries.idempotencyKey, sendKeys), inArray(mailDeliveries.idempotencyDigest, sendKeys.map(key => receipts.digest("send", key))))).orderBy(mailDeliveries.id).for("update");
      for (const copy of copies) {
        if (copy.attempts === 0 && ["queued", "held", "failed"].includes(copy.status)) {
          await tx.update(mailDeliveries).set({ status: "suppressed", holdReason: null, lastError: null }).where(eq(mailDeliveries.id, copy.id));
          await tx.delete(mailOutbox).where(eq(mailOutbox.deliveryId, copy.id));
        }
        const [settlement] = await tx.execute<{ settled: boolean }>(sql`select (${terminalDelivery}) as settled from ${mailDeliveries} where ${mailDeliveries.id}=${copy.id}`);
        if (!settlement?.settled) attemptPending = true;
        else if (containsAddress(copy.subject) || containsAddress(copy.lastError)) await tx.update(mailDeliveries).set({ ...(containsAddress(copy.subject) ? { subject: translator(notice.locale)("notifications.event.mail.title") } : {}), ...(containsAddress(copy.lastError) ? { lastError: null } : {}) }).where(eq(mailDeliveries.id, copy.id));
      }
      if (attempt.attempts === 0 && ["pending", "deferred", "failed"].includes(attempt.status)) await tx.update(notificationDeliveries).set({ status: "skipped", lastError: null }).where(eq(notificationDeliveries.id, attempt.id));
      else if (!attemptPending && containsAddress(attempt.lastError)) await tx.update(notificationDeliveries).set({ lastError: null }).where(eq(notificationDeliveries.id, attempt.id));
      pending ||= attemptPending;
    }
  }
  return pending;
}
async function redactRows(tx: Tx, kind: MailRecordKind, rows: Row[], receipts: MailReceipts): Promise<number> {
  if (!rows.length) return 0;
  await sealMailReceipts(tx);
  let redacted = 0;
  for (const row of rows) {
    if (await minimizeDerivedNotices(tx, kind, row.id, row.address, receipts)) continue;
    const addressDigest = row.addressDigest ?? receipts.digest("address", row.address), redactedAt = new Date();
    if (kind === "delivery") await tx.update(mailDeliveries).set({ recipientDigest: addressDigest, idempotencyDigest: row.sendDigest ?? (row.sendKey ? receipts.digest("send", row.sendKey) : null), providerRefDigest: row.refDigest ?? (row.ref ? receipts.digest(`provider:${row.provider}`, row.ref) : null), redactedAt, recipient: `redacted-${row.id}@retained.invalid`, subject: "", lastError: null, idempotencyKey: null, providerRef: null }).where(eq(mailDeliveries.id, row.id));
    else if (kind === "event") await tx.update(mailProviderEvents).set({ recipientDigest: addressDigest, externalEventDigest: row.eventDigest ?? receipts.digest(`event:${row.provider}`, row.eventKey!), providerRefDigest: row.refDigest ?? (row.ref ? receipts.digest(`provider:${row.provider}`, row.ref) : null), redactedAt, recipient: `redacted-${row.id}@retained.invalid`, detail: null, externalEventId: `retained:${row.id}`, providerRef: null }).where(eq(mailProviderEvents.id, row.id));
    else {
      await tx.update(mailSuppressions).set({ emailDigest: addressDigest, redactedAt, email: `redacted-${row.id}@retained.invalid`, detail: null }).where(eq(mailSuppressions.id, row.id));
      await tx.update(auditLog).set({ subjectId: row.id, diff: sql`${auditLog.diff}-'email'` }).where(and(eq(auditLog.action, "mail.releaseSuppression"), eq(auditLog.subjectType, "mail_suppression"), inArray(auditLog.subjectId, [row.id, row.address])));
    }
    await removeDerivedPersonalFields(tx, kind, [row.id]);
    redacted++;
  }
  return redacted;
}

export async function minimizeMailRecordsInTransaction(tx: Tx, refs: MailRecordRef[], options: { cancelUnsent?: boolean } = {}): Promise<{ redacted: number; pending: MailRecordRef[] }> {
    await lockContactIdentityForRead(tx);
    const held = await lockMailHolds(tx), receipts = await lockMailReceiptWrites(tx);
    const deliveryIds = refs.filter(ref => ref.kind === "delivery").map(ref => ref.id);
    if (options.cancelUnsent && deliveryIds.length) {
      const cancel = await tx.select({ id: mailDeliveries.id }).from(mailDeliveries).where(and(inArray(mailDeliveries.id, deliveryIds), eq(mailDeliveries.attempts, 0), inArray(mailDeliveries.status, ["queued", "failed", "held"]), isNull(mailDeliveries.redactedAt), unheld("delivery", mailDeliveries.id, held))).orderBy(mailDeliveries.id).for("update");
      if (cancel.length) {
        const ids = cancel.map(row => row.id);
        await tx.update(mailDeliveries).set({ status: "suppressed", holdReason: null, lastError: null }).where(inArray(mailDeliveries.id, ids));
        await tx.delete(mailOutbox).where(inArray(mailOutbox.deliveryId, ids));
      }
    }
    let redacted = 0;
    for (const kind of ["delivery", "event", "suppression"] as const) {
      const ids = refs.filter(ref => ref.kind === kind).map(ref => ref.id);
      if (ids.length) redacted += await redactRows(tx, kind, await candidates(tx, kind, held, undefined, ids, Boolean(options.cancelUnsent)), receipts);
    }
    const pending: MailRecordRef[] = [];
    for (const kind of ["delivery", "event", "suppression"] as const) {
      const ids = refs.filter(ref => ref.kind === kind).map(ref => ref.id), table = tableFor(kind);
      if (ids.length) for (const row of await tx.select({ id: table.id }).from(table).where(and(inArray(table.id, ids), isNull(table.redactedAt)))) pending.push({ kind, id: row.id });
    }
    return { redacted, pending };
}
export async function minimizeMailRecords(refs: MailRecordRef[], options: { cancelUnsent?: boolean } = {}): Promise<{ redacted: number; pending: MailRecordRef[] }> {
  return db().transaction(tx => minimizeMailRecordsInTransaction(tx, refs, options));
}

for (const [kind, record] of [["mail_deliveries", "delivery"], ["mail_provider_events", "event"], ["mail_suppressions", "suppression"]] as const) registerRetentionSource({
  kind, tables: [kind], privacyScope: MAIL_RECORDS_SCOPE,
  purge: async args => {
    let total = 0;
    for (;;) {
      const count = await db().transaction(async tx => {
        await lockContactIdentityForRead(tx);
        const held = [...new Set([...(await lockMailHolds(tx)), ...args.exceptContactIds])], receipts = await lockMailReceiptWrites(tx);
        return redactRows(tx, record, await candidates(tx, record, held, args.cutoff), receipts);
      });
      total += count;
      if (count < RETENTION_PURGE_BATCH) return total;
    }
  },
});
