// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: immutable financial children participate in original-owner undo.
import { inArray, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "@/core/service";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import * as tables from "./merchant-refund-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
export interface MerchantRefundDependencyReceipt { version: 1; entries: Array<{ table: string; id: string; fingerprint: string }>; incomplete: boolean }
const MAX = 5000;
const ids = (column: string, values: readonly string[]): SQL => values.length
  ? sql`${sql.identifier("r")}.${sql.identifier(column)} in (${sql.join(values.map(value => sql`${value}::uuid`), sql`, `)})` : sql`false`;
const owner = (paymentIds: readonly string[], receiptIds: readonly string[]) => sql`(${ids("payment_id", paymentIds)} or ${ids("subscription_charge_receipt_id", receiptIds)})`;
export async function merchantRefundDependencyFingerprints(tx: Tx, input: { paymentIds: readonly string[]; subscriptionChargeReceiptIds: readonly string[] }): Promise<MerchantRefundDependencyReceipt> {
  const incomplete = (): MerchantRefundDependencyReceipt => ({ version: 1, entries: [], incomplete: true });
  let paymentIds = [...new Set(input.paymentIds)], receiptIds = [...new Set(input.subscriptionChargeReceiptIds)];
  if (paymentIds.length > MAX || receiptIds.length > MAX) return incomplete();
  if (!paymentIds.length && !receiptIds.length) return { version: 1, entries: [], incomplete: false };
  if (paymentIds.length) {
    const aliases = await tx.select({ id: merchantAgreementPaymentRoutes.originalChargeReceiptId }).from(merchantAgreementPaymentRoutes)
      .where(inArray(merchantAgreementPaymentRoutes.paymentId, paymentIds)).limit(MAX + 1);
    if (aliases.length > MAX) return incomplete();
    receiptIds = [...new Set([...receiptIds, ...aliases.map(row => row.id).filter((id): id is string => id !== null)])];
  }
  if (receiptIds.length) {
    const aliases = await tx.select({ id: merchantAgreementPaymentRoutes.paymentId }).from(merchantAgreementPaymentRoutes)
      .where(inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId, receiptIds)).limit(MAX + 1);
    if (aliases.length > MAX) return incomplete();
    paymentIds = [...new Set([...paymentIds, ...aliases.map(row => row.id)])];
  }
  if (paymentIds.length > MAX || receiptIds.length > MAX) return incomplete();
  const collected: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
  let overflow = false;
  const read = async (name: string, table: PgTable, where: SQL) => {
    const result = await tx.execute<{ row: Record<string, unknown> }>(sql`select to_jsonb(r) as row from ${table} r where ${where} limit ${MAX + 1}`);
    const rows = result.map(item => item.row);
    overflow ||= rows.length > MAX;
    collected.push({ table: name, rows });
    return rows;
  };
  const requests = await read("merchant_refund_requests", tables.merchantRefundRequests, owner(paymentIds, receiptIds));
  const inspections = await read("merchant_cash_return_inspections", tables.merchantCashReturnInspections, owner(paymentIds, receiptIds));
  const resolutions = await read("merchant_unapplied_charge_resolutions", tables.merchantUnappliedChargeResolutions, owner(paymentIds, receiptIds));
  if (overflow) return incomplete();
  const rowIds = (rows: Record<string, unknown>[]) => rows.map(row => row.id).filter((id): id is string => typeof id === "string");
  const requestIds = rowIds(requests), inspectionIds = rowIds(inspections), resolutionIds = rowIds(resolutions);
  const dispatches = await read("merchant_refund_dispatches", tables.merchantRefundDispatches, ids("request_id", requestIds));
  if (overflow) return incomplete();
  const dispatchIds = rowIds(dispatches);
  await read("merchant_refund_observations", tables.merchantRefundObservations, sql`(${owner(paymentIds, receiptIds)} or ${ids("request_id", requestIds)})`);
  await read("merchant_refund_reservation_retirements", tables.merchantRefundReservationRetirements, ids("request_id", requestIds));
  await read("merchant_refund_creation_refusals", tables.merchantRefundCreationRefusals, ids("dispatch_id", dispatchIds));
  await read("merchant_refund_terminal_receipts", tables.merchantRefundTerminalReceipts, ids("request_id", requestIds));
  await read("merchant_refund_dispatch_finishes", tables.merchantRefundDispatchFinishes, ids("dispatch_id", dispatchIds));
  await read("merchant_refund_dispatch_stops", tables.merchantRefundDispatchStops, ids("dispatch_id", dispatchIds));
  await read("merchant_refund_resource_bindings", tables.merchantRefundResourceBindings, ids("request_id", requestIds));
  await read("merchant_cash_return_inspection_finishes", tables.merchantCashReturnInspectionFinishes, ids("inspection_id", inspectionIds));
  await read("merchant_cash_return_primary_observations", tables.merchantCashReturnPrimaryObservations, ids("inspection_id", inspectionIds));
  await read("merchant_cash_return_observations", tables.merchantCashReturnObservations, ids("inspection_id", inspectionIds));
  await read("merchant_unapplied_charge_resolution_refunds", tables.merchantUnappliedChargeResolutionRefunds, ids("resolution_id", resolutionIds));
  if (overflow || collected.reduce((sum, group) => sum + group.rows.length, 0) > MAX) return incomplete();
  const entries: MerchantRefundDependencyReceipt["entries"] = [];
  for (const group of collected) for (const row of group.rows) {
    const composite = typeof row.resolution_id === "string" && typeof row.observation_id === "string" ? `${row.resolution_id}:${row.observation_id}` : null;
    const key = row.id ?? row.dispatch_id ?? row.request_id ?? row.inspection_id ?? composite;
    if (typeof key !== "string") return incomplete();
    entries.push({ table: group.table, id: key, fingerprint: merchantTaxDigest(row) });
  }
  return { version: 1, entries: entries.toSorted((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id)), incomplete: false };
}
