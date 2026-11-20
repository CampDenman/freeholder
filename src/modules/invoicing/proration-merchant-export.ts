// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: authorized merchant history is distinct from the buyer export.
import { sql, type SQL } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { prorationFinancialWitness, type ProrationFinancialEntry, type ProrationFinancialTable } from "./proration-financial-witness";

type Scalar = string | number | boolean | null;
interface Projection { id: string; fields: Readonly<Record<string, SQL>>; joins?: SQL }
const column = (name: string) => sql`${sql.identifier("r")}.${sql.identifier(name)}`;
const feeFields = { feeObligationMinor: column("fee_obligation_minor"), feeProvenCollectedMinor: column("fee_proven_collected_minor"),
  feeCollectionState: column("fee_collection_state"), feeUnexpected: column("fee_unexpected") };
const created = { createdAt: column("created_at") };
// Explicit scalar column whitelists. Neither to_jsonb(row)-redaction nor an
// evolving public/buyer DTO defines what this merchant is allowed to export.
const projections: Record<ProrationFinancialTable, Projection> = {
  commercial_payment_attestations: { id: "payment_id", fields: { amountMinor: column("amount_minor"), currency: column("currency"), feeOwedMinor: column("fee_owed_minor"),
    profileVersion: column("profile_version"), status: sql`actual_payment.status`, processedAt: sql`actual_payment.processed_at`, failedAt: sql`actual_payment.failed_at`, ...created },
    joins: sql`left join payments actual_payment on actual_payment.id=r.payment_id` },
  commercial_refund_attestations: { id: "refund_id", fields: { amountMinor: column("amount_minor"), currency: column("currency"), status: sql`actual_refund.status`, processedAt: sql`actual_refund.processed_at`, failedAt: sql`actual_refund.failed_at`, ...created },
    joins: sql`left join refunds actual_refund on actual_refund.id=r.refund_id` },
  commercial_fee_attestations: { id: "id", fields: { direction: column("direction"), amountMinor: column("amount_minor"), currency: sql`original_payment.currency`, ...created },
    joins: sql`left join commercial_payment_attestations original_payment on original_payment.payment_id=r.payment_id` },
  invoice_credit_funding: { id: "id", fields: { amountMinor: column("amount_minor"), currency: sql`original_invoice.currency`, noteStatus: sql`original_note.status`, ...feeFields, ...created },
    joins: sql`left join invoices original_invoice on original_invoice.id=r.source_invoice_id left join credit_notes original_note on original_note.id=r.credit_note_id` },
  invoice_credit_reservations: { id: "id", fields: { amountMinor: column("amount_minor"), currency: sql`original_invoice.currency`, ...feeFields, ...created,
    status: sql`case when application.reservation_id is not null then 'applied' when released.reservation_id is not null then 'released' else 'reserved' end`,
    appliedAt: sql`application.created_at`, releasedAt: sql`released.created_at` },
    joins: sql`left join invoice_credit_funding funding on funding.id=r.funding_id left join invoices original_invoice on original_invoice.id=funding.source_invoice_id
      left join invoice_credit_applications application on application.reservation_id=r.id left join invoice_credit_releases released on released.reservation_id=r.id` },
  invoice_credit_applications: { id: "reservation_id", fields: { amountMinor: sql`original_reservation.amount_minor`, currency: sql`target_invoice.currency`, ...feeFields, ...created },
    joins: sql`left join invoice_credit_reservations original_reservation on original_reservation.id=r.reservation_id left join invoices target_invoice on target_invoice.id=r.invoice_id` },
  invoice_credit_releases: { id: "reservation_id", fields: { amountMinor: sql`original_reservation.amount_minor`, currency: sql`original_invoice.currency`, ...created },
    joins: sql`left join invoice_credit_reservations original_reservation on original_reservation.id=r.reservation_id
      left join invoice_credit_funding funding on funding.id=original_reservation.funding_id left join invoices original_invoice on original_invoice.id=funding.source_invoice_id` },
  subscription_prorations: { id: "id", fields: { currency: sql`r.snapshot->>'currency'`, billingMode: sql`r.snapshot->>'billingMode'`, state: column("state"), profileVersion: column("profile_version"),
    debitNetMinor: column("debit_net_minor"), debitTaxMinor: column("debit_tax_minor"), creditNetMinor: column("credit_net_minor"), creditTaxMinor: column("credit_tax_minor"),
    debitFeeObligationMinor: column("debit_fee_obligation_minor"), creditFeeObligationMinor: column("credit_fee_obligation_minor"),
    appliedFeeObligationMinor: column("applied_fee_obligation_minor"), appliedFeeProvenCollectedMinor: column("applied_fee_proven_collected_minor"),
    effectiveAt: column("effective_at"), originalPeriodStart: column("original_period_start"), originalPeriodEnd: column("original_period_end"),
    originalTrialEndsAt: column("original_trial_ends_at"), proposedPeriodStart: column("proposed_period_start"), proposedPeriodEnd: column("proposed_period_end"),
    appliedAt: column("applied_at"), cancelledAt: column("cancelled_at"), ...created } },
  subscription_proration_principal: { id: "id", fields: { amountMinor: column("amount_minor"), currency: sql`original_payment.currency`, ...feeFields, ...created },
    joins: sql`left join payments original_payment on original_payment.id=r.source_payment_id` },
  subscription_proration_credit_uses: { id: "id", fields: { amountMinor: column("amount_minor"), currency: sql`original_invoice.currency`, ...created },
    joins: sql`left join credit_notes original_note on original_note.id=r.credit_note_id left join invoices original_invoice on original_invoice.id=original_note.invoice_id` },
  agreement_fee_duties: { id: "invoice_id", fields: { currency: column("currency"), profileVersion: column("profile_version"), totalMinor: column("total_minor"),
    targetFeeMinor: column("target_fee_minor"), creditedMinor: column("credited_minor"), carriedFeeMinor: column("carried_fee_minor"), cashPrincipalMinor: column("cash_principal_minor"),
    cashFeeTargetMinor: column("cash_fee_target_minor"), expectedReceivableMinor: column("expected_receivable_minor"), ...created } },
  agreement_fee_credit_assignments: { id: "application_id", fields: { amountMinor: column("amount_minor"), feeObligationMinor: column("fee_obligation_minor"),
    provenCollectedMinor: column("proven_collected_minor"), currency: sql`duty.currency`, ...created }, joins: sql`left join agreement_fee_duties duty on duty.invoice_id=r.invoice_id` },
  agreement_fee_cash_assignments: { id: "payment_id", fields: { amountMinor: column("amount_minor"), feeObligationMinor: column("fee_obligation_minor"), origin: column("origin"),
    currency: sql`duty.currency`, ...created }, joins: sql`left join agreement_fee_duties duty on duty.invoice_id=r.invoice_id` },
  agreement_fee_eligibility: { id: "invoice_id", fields: { paidAt: column("paid_at"), ...created } },
  agreement_fee_remittances: { id: "id", fields: { direction: column("direction"), amountMinor: column("amount_minor"), currency: column("currency"), ...created } },
  subscription_proration_cash_confirmations: { id: "payment_id", fields: { retainedAt: column("retained_at"),
    amountMinor: sql`case when r.provider_observation_id is null then external_receipt.amount_minor else provider_receipt.amount_minor end`,
    currency: sql`case when r.provider_observation_id is null then external_receipt.currency else provider_receipt.currency end` },
    joins: sql`left join commercial_payment_attestations external_receipt on external_receipt.payment_id=r.external_attestation_id
      left join merchant_payment_observations provider_receipt on provider_receipt.id=r.provider_observation_id` },
  subscription_proration_credit_confirmations: { id: "application_id", fields: { retainedAt: column("retained_at"), amountMinor: sql`original_reservation.amount_minor`, currency: sql`target_invoice.currency` },
    joins: sql`left join invoice_credit_applications application on application.reservation_id=r.application_id
      left join invoice_credit_reservations original_reservation on original_reservation.id=application.reservation_id left join invoices target_invoice on target_invoice.id=r.invoice_id` },
  subscription_proration_payment_protocols: { id: "payment_id", fields: { providerApiVersion: column("provider_api_version"), requestedAmountMinor: sql`actual_payment.amount_minor`,
    currency: sql`actual_payment.currency`, status: sql`actual_payment.status`, ...created }, joins: sql`left join payments actual_payment on actual_payment.id=r.payment_id` },
  subscription_proration_card_mandates: { id: "proration_id", fields: { ...created } },
  subscription_proration_card_attempts: { id: "payment_id", fields: { requestedAmountMinor: sql`actual_payment.amount_minor`, currency: sql`actual_payment.currency`, status: sql`actual_payment.status`, ...created },
    joins: sql`left join payments actual_payment on actual_payment.id=r.payment_id` },
  subscription_proration_card_jobs: { id: "job_id", fields: { ...created } },
  subscription_proration_card_reads: { id: "id", fields: { status: sql`case when actual_finish.read_id is not null then 'finish_recorded' when independent_stop.read_id is not null then 'stop_review_recorded' else 'admitted' end`,
    finishedAt: sql`actual_finish.created_at`, stopReviewedAt: sql`independent_stop.created_at`, ...created },
    joins: sql`left join subscription_proration_card_read_finishes actual_finish on actual_finish.read_id=r.id left join subscription_proration_card_read_stops independent_stop on independent_stop.read_id=r.id` },
  subscription_proration_card_read_finishes: { id: "read_id", fields: { outcome: sql`r.actual_result->>'outcome'`, ...created } },
  subscription_proration_card_read_stops: { id: "read_id", fields: { ...created } },
};
export interface MerchantProrationHistoryEntry { family: ProrationFinancialEntry["family"]; table: ProrationFinancialTable; id: string; parents: ProrationFinancialEntry["parents"]; record: Record<string, Scalar> }
const conflict = () => new ServiceError("conflict", "Restore the complete unchanged original merchant financial history before exporting it.");

/** The actual privacy parent must authorize these exact original profiles.
 * existingRows is its already selected profile/version/registration/cash row
 * count; it cannot replace root's final aggregate check. No service context,
 * buyer projection or current-contact/account guess supplies ownership. */
export async function exportProrationMerchantHistory(tx: Tx, profileIds: readonly string[], options: { existingRows?: number } = {}): Promise<{ version: 1; entries: MerchantProrationHistoryEntry[] }> {
  const existingRows = options.existingRows ?? 0;
  if (!Number.isSafeInteger(existingRows) || existingRows < 0 || existingRows > 5000) throw conflict();
  const original = await prorationFinancialWitness(tx, { kind: "merchant_profile", ids: profileIds });
  if (original.incomplete || original.entries.length + existingRows > 5000) throw conflict();
  const authorizedProfiles = new Set(profileIds), result: MerchantProrationHistoryEntry[] = [];
  const byTable = new Map<ProrationFinancialTable, ProrationFinancialEntry[]>();
  for (const entry of original.entries) {
    if (!entry.parents.profileId || !authorizedProfiles.has(entry.parents.profileId)) throw conflict();
    const selected = byTable.get(entry.table) ?? [];selected.push(entry);byTable.set(entry.table, selected);
  }
  for (const [table, selected] of byTable) {
    if (!Object.hasOwn(projections, table)) throw conflict();
    const projection = projections[table], fields = Object.entries(projection.fields), expected = new Map(selected.map(entry => [entry.id, entry]));
    if (expected.size !== selected.length) throw conflict();
    const records = await tx.execute<{ id: string; fingerprint: string; record: Record<string, unknown> }>(sql`
      select ${column(projection.id)}::text id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') fingerprint,
       jsonb_build_object(${sql.join(fields.flatMap(([key, value]) => [sql`${key}::text`, value]), sql`,`)}) record
      from ${sql.identifier(table)} r ${projection.joins ?? sql``}
      where ${column(projection.id)} in (${sql.join(selected.map(entry => sql`${entry.id}::uuid`), sql`,`)}) order by ${column(projection.id)} limit 5001`);
    if (records.length !== expected.size || records.length + result.length + existingRows > 5000) throw conflict();
    for (const row of records) {
      const entry = expected.get(row.id);
      if (!entry || row.fingerprint !== entry.fingerprint || !row.record || typeof row.record !== "object" || Array.isArray(row.record)
        || Object.keys(row.record).length !== fields.length) throw conflict();
      const record: Record<string, Scalar> = {};
      for (const [key] of fields) {
        if (!Object.hasOwn(row.record, key)) throw conflict();
        const value = row.record[key];
        if ((value !== null && !["string", "number", "boolean"].includes(typeof value)) || (typeof value === "number" && !Number.isSafeInteger(value))) throw conflict();
        if ((key.endsWith("Minor") && (typeof value !== "number" || value < 0)) || (key === "currency" && (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)))) throw conflict();
        record[key] = value as Scalar;
      }
      result.push({ family: entry.family, table, id: entry.id, parents: { ...entry.parents }, record });expected.delete(row.id);
    }
    if (expected.size) throw conflict();
  }
  const current = await prorationFinancialWitness(tx, { kind: "merchant_profile", ids: profileIds });
  if (current.incomplete || JSON.stringify(current.entries) !== JSON.stringify(original.entries)) throw conflict();
  return { version: 1, entries: result.sort((left, right) => left.table.localeCompare(right.table) || left.id.localeCompare(right.id)) };
}
