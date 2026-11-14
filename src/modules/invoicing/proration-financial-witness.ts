// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: exact original financial children before payment routing.
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/core/service";

export type ProrationFinancialScope = { kind: "invoice" | "subscription" | "merchant_profile"; ids: readonly string[] };
const groups = {
  commercial_payment_attestations: "money", commercial_refund_attestations: "money", commercial_fee_attestations: "money",
  invoice_credit_funding: "money", invoice_credit_reservations: "money", invoice_credit_applications: "money", invoice_credit_releases: "money",
  subscription_prorations: "proration", subscription_proration_principal: "proration", subscription_proration_credit_uses: "proration",
  agreement_fee_duties: "fee", agreement_fee_credit_assignments: "fee", agreement_fee_cash_assignments: "fee", agreement_fee_eligibility: "fee", agreement_fee_remittances: "fee",
  subscription_proration_cash_confirmations: "boundary", subscription_proration_credit_confirmations: "boundary",
  subscription_proration_payment_protocols: "card", subscription_proration_card_mandates: "card", subscription_proration_card_attempts: "card",
  subscription_proration_card_jobs: "card", subscription_proration_card_reads: "card", subscription_proration_card_read_finishes: "card", subscription_proration_card_read_stops: "card",
} as const;
export type ProrationFinancialTable = keyof typeof groups;
const parentNames = ["invoiceId", "sourceInvoiceId", "targetInvoiceId", "subscriptionId", "profileId", "prorationId", "sourceProrationId", "targetProrationId",
  "paymentId", "sourcePaymentId", "refundId", "creditNoteId", "creditNoteLineId", "fundingId", "reservationId", "applicationId", "sourceApplicationId", "originalRemittanceId", "providerObservationId", "externalAttestationId", "readId", "jobId", "paymentMethodId"] as const;
export type ProrationFinancialParents = Partial<Record<typeof parentNames[number], string | null>>;
export interface ProrationFinancialEntry { family: typeof groups[ProrationFinancialTable]; table: ProrationFinancialTable; id: string; fingerprint: string; parents: ProrationFinancialParents }
export interface ProrationFinancialWitness { version: 1; entries: ProrationFinancialEntry[]; incomplete: boolean }
const uuid = z.uuid(), sha = z.string().regex(/^[a-f0-9]{64}$/), MAX = 5000;
const col = (alias: string, name: string) => sql`${sql.identifier(alias)}.${sql.identifier(name)}`;
const oneOf = (column: SQL, ids: Iterable<string>) => { const values = [...ids]; return values.length ? sql`${column} in (${sql.join(values.map(id => sql`${id}::uuid`), sql`,`)})` : sql`false`; };
const source = (alias: string) => sql`${col(alias, "subscription_id")}::text||':proration:'||${col(alias, "id")}::text`;

/** Ordinary read-only adapter. Existing witness helpers remain unchanged.
 * The original seventeen and seven card families follow exact parent
 * FKs so a merchant need not adopt every party on a mixed source invoice.
 * No service registry, provider call, actor clone, amount or current account
 * supplies ownership. Root must check incomplete and add its cohort bound. */
export async function prorationFinancialWitness(tx: Tx, scope: ProrationFinancialScope): Promise<ProrationFinancialWitness> {
  const failed = (): ProrationFinancialWitness => ({ version: 1, entries: [], incomplete: true });
  if (!z.array(uuid).max(MAX).safeParse(scope.ids).success || !["invoice", "subscription", "merchant_profile"].includes(scope.kind)) return failed();
  const ids = new Set(scope.ids);
  if (!ids.size) return { version: 1, entries: [], incomplete: false };
  const entries = new Map<string, ProrationFinancialEntry>();
  let invalid = false;
  const pids = new Set<string>(), fids = new Set<string>(), rids = new Set<string>(), aids = new Set<string>();
  const paymentIds = new Set<string>(), dutyIds = new Set<string>(), linkedInvoices = new Map<string, Set<string>>();
  const prorations = new Map<string, ProrationFinancialParents>(), funding = new Map<string, ProrationFinancialParents>(), reservations = new Map<string, ProrationFinancialParents>(), applications = new Map<string, ProrationFinancialParents>();
  const linkInvoice = (invoiceId: string | null | undefined, profileId: string | null | undefined) => {
    if (!invoiceId || !profileId) return;
    const owners = linkedInvoices.get(invoiceId) ?? new Set<string>(); owners.add(profileId); linkedInvoices.set(invoiceId, owners);
  };
  const bounded = () => entries.size <= MAX && pids.size + fids.size + rids.size + aids.size <= MAX;
  async function read(table: ProrationFinancialTable, id: SQL, parents: SQL, from: SQL, where: SQL, valid: SQL = sql`true`) {
    if (invalid) return [];
    const rows = await tx.execute<{ id: string; fingerprint: string; parents: ProrationFinancialParents; valid: boolean }>(sql`
      select ${id}::text id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') fingerprint,
       ${parents} parents,(${valid}) is true valid from ${from} where ${where} order by ${id} limit ${MAX + 1}`);
    if (rows.length > MAX) { invalid = true; return []; }
    const accepted: Array<(typeof rows)[number]> = [];
    for (const row of rows) {
      if (!row.valid || !uuid.safeParse(row.id).success || !sha.safeParse(row.fingerprint).success || !row.parents || typeof row.parents !== "object"
        || Array.isArray(row.parents) || !uuid.safeParse(row.parents.profileId).success
        || Object.entries(row.parents).some(([key, value]) => !parentNames.includes(key as typeof parentNames[number]) || value !== null && !uuid.safeParse(value).success)) { invalid = true; continue; }
      if (scope.kind === "merchant_profile" && (!row.parents.profileId || !ids.has(row.parents.profileId))) { invalid = true; continue; }
      const entry: ProrationFinancialEntry = { family: groups[table], table, id: row.id, fingerprint: row.fingerprint, parents: row.parents }, key = `${table}:${row.id}`, prior = entries.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) invalid = true;
      entries.set(key, entry);
      accepted.push(row);
    }
    if (!bounded()) invalid = true;
    return accepted;
  }
  const pScope = scope.kind === "invoice" ? sql`(${oneOf(col("r", "original_invoice_id"), ids)} or ${oneOf(col("r", "debit_invoice_id"), ids)})`
    : oneOf(col("r", scope.kind === "subscription" ? "subscription_id" : "profile_id"), ids);
  async function readProrations() {
    const rows = await read("subscription_prorations", col("r", "id"), sql`jsonb_build_object('prorationId',r.id,'subscriptionId',r.subscription_id,'profileId',r.profile_id,
      'sourceInvoiceId',r.original_invoice_id,'targetInvoiceId',r.debit_invoice_id,'creditNoteId',r.credit_note_id)`, sql`subscription_prorations r`, sql`(${pScope} or ${oneOf(col("r", "id"), pids)})`);
    for (const row of rows) { pids.add(row.id); prorations.set(row.id, row.parents); linkInvoice(row.parents.sourceInvoiceId, row.parents.profileId); linkInvoice(row.parents.targetInvoiceId, row.parents.profileId); }
  }
  await readProrations();
  // Initial external principal has an immutable merchant owner even before
  // the agreement has any proration. Subscription source matching requires
  // an actual existing subscription and its exact canonical invoice source.
  const invoiceSeed = scope.kind === "invoice" ? oneOf(col("r", "invoice_id"), ids) : scope.kind === "merchant_profile" ? oneOf(col("r", "merchant_profile_id"), ids)
    : sql`exists(select 1 from invoices i join subscriptions s on i.source_type='subscription' and split_part(i.source_id,':',1)=s.id::text where i.id=r.invoice_id and ${oneOf(col("s", "id"), ids)})`;
  const attestationFrom = sql`commercial_payment_attestations r left join payments original_payment on original_payment.id=r.payment_id`;
  const attestationParents = sql`jsonb_build_object('paymentId',r.payment_id,'invoiceId',r.invoice_id,'profileId',r.merchant_profile_id)`;
  const initialPayments = await read("commercial_payment_attestations", col("r", "payment_id"), attestationParents, attestationFrom, invoiceSeed, sql`original_payment.invoice_id=r.invoice_id`);
  for (const row of initialPayments) { paymentIds.add(row.id); linkInvoice(row.parents.invoiceId, row.parents.profileId); }
  // Funding can own the requested source or an exact target before application.
  const fundingSeed = scope.kind === "invoice" ? sql`(${oneOf(col("r", "source_invoice_id"), ids)} or exists(select 1 from invoice_credit_reservations target_reservation
      left join invoice_credit_applications applied on applied.reservation_id=target_reservation.id
      left join subscription_prorations target on target_reservation.target_source_id=${source("target")}
      where target_reservation.funding_id=r.id and (${oneOf(col("applied", "invoice_id"), ids)} or ${oneOf(col("target", "debit_invoice_id"), ids)})))`
    : oneOf(col("owner", scope.kind === "subscription" ? "subscription_id" : "profile_id"), ids);
  async function readFunding() {
    const rows = await read("invoice_credit_funding", col("r", "id"), sql`jsonb_build_object('fundingId',r.id,'sourceProrationId',r.proration_id,'profileId',owner.profile_id,'subscriptionId',owner.subscription_id,
      'sourceInvoiceId',r.source_invoice_id,'sourcePaymentId',r.source_payment_id,'sourceApplicationId',r.source_application_id,'creditNoteId',r.credit_note_id,'creditNoteLineId',r.credit_note_line_id)`,
      sql`invoice_credit_funding r left join subscription_prorations owner on owner.id=r.proration_id left join credit_notes note on note.id=r.credit_note_id
        left join credit_note_lines line on line.id=r.credit_note_line_id left join payments principal on principal.id=r.source_payment_id`,
      sql`(${fundingSeed} or ${oneOf(col("r", "id"), fids)} or ${oneOf(col("r", "proration_id"), pids)}
        or exists(select 1 from invoice_credit_reservations target_reservation join subscription_prorations target on target_reservation.target_source_id=${source("target")}
          where target_reservation.funding_id=r.id and ${oneOf(col("target", "id"), pids)})
        or exists(select 1 from subscription_proration_credit_uses target_use where target_use.credit_note_id=r.credit_note_id and ${oneOf(col("target_use", "proration_id"), pids)}))`,
      sql`owner.id is not null and owner.credit_note_id=r.credit_note_id and owner.original_invoice_id=r.source_invoice_id and note.invoice_id=r.source_invoice_id and line.credit_note_id=note.id
        and principal.id is not null and (r.source_application_id is not null or principal.invoice_id=r.source_invoice_id)
        and not exists(select 1 from return_requests original_return where original_return.credit_note_id=r.credit_note_id)`);
    for (const row of rows) { fids.add(row.id); funding.set(row.id, row.parents); if (row.parents.sourceProrationId) pids.add(row.parents.sourceProrationId); if (row.parents.sourceApplicationId) { aids.add(row.parents.sourceApplicationId); rids.add(row.parents.sourceApplicationId); } linkInvoice(row.parents.sourceInvoiceId, row.parents.profileId); }
  }
  async function readReservations() {
    const rows = await read("invoice_credit_reservations", col("r", "id"), sql`jsonb_build_object('reservationId',r.id,'fundingId',r.funding_id,'profileId',owner.profile_id,'sourceProrationId',f.proration_id,
      'targetProrationId',target.id,'subscriptionId',target.subscription_id,'sourceInvoiceId',f.source_invoice_id,'targetInvoiceId',target.debit_invoice_id,'creditNoteId',f.credit_note_id)`,
      sql`invoice_credit_reservations r left join invoice_credit_funding f on f.id=r.funding_id left join subscription_prorations owner on owner.id=f.proration_id
        left join subscription_prorations target on r.target_source_id=${source("target")} left join invoices target_invoice on target_invoice.id=target.debit_invoice_id`,
      sql`(${oneOf(col("r", "funding_id"), fids)} or ${oneOf(col("r", "id"), rids)})`,
      sql`owner.id is not null and target.id is not null and owner.profile_id=target.profile_id
        and (target.debit_invoice_id is null or (target_invoice.source_type='subscription' and target_invoice.source_id=r.target_source_id))`);
    for (const row of rows) { rids.add(row.id); reservations.set(row.id, row.parents); if (row.parents.fundingId) fids.add(row.parents.fundingId); if (row.parents.targetProrationId) pids.add(row.parents.targetProrationId); linkInvoice(row.parents.targetInvoiceId, row.parents.profileId); }
  }
  async function readApplications() {
    const rows = await read("invoice_credit_applications", col("r", "reservation_id"), sql`jsonb_build_object('applicationId',r.reservation_id,'reservationId',r.reservation_id,'fundingId',f.id,'profileId',owner.profile_id,
      'sourceProrationId',f.proration_id,'targetProrationId',target.id,'sourceInvoiceId',f.source_invoice_id,'targetInvoiceId',r.invoice_id,'creditNoteId',f.credit_note_id)`,
      sql`invoice_credit_applications r left join invoice_credit_reservations reservation on reservation.id=r.reservation_id left join invoice_credit_funding f on f.id=reservation.funding_id
        left join subscription_prorations owner on owner.id=f.proration_id left join subscription_prorations target on reservation.target_source_id=${source("target")}
        left join invoices target_invoice on target_invoice.id=r.invoice_id`,
      sql`(${oneOf(col("r", "reservation_id"), rids)} or ${oneOf(col("r", "reservation_id"), aids)})`,
      sql`owner.id is not null and target.id is not null and owner.profile_id=target.profile_id and target.debit_invoice_id=r.invoice_id
        and target_invoice.source_type='subscription' and target_invoice.source_id=reservation.target_source_id`);
    for (const row of rows) { aids.add(row.id); applications.set(row.id, row.parents); rids.add(row.id); if (row.parents.fundingId) fids.add(row.parents.fundingId); if (row.parents.targetProrationId) pids.add(row.parents.targetProrationId); }
  }
  // UNION-like finite closure over actual source applications and target
  // reservations. Repeated IDs do not count as invented financial rows.
  let settled = false;
  for (let round = 0; round <= MAX && !invalid; round++) {
    const before = `${pids.size}:${fids.size}:${rids.size}:${aids.size}`;
    await readFunding();await readReservations();await readApplications();await readProrations();
    if (!bounded()) invalid = true;
    if (before === `${pids.size}:${fids.size}:${rids.size}:${aids.size}`) { settled = true; break; }
  }
  if (invalid || !settled) return failed();
  for (const id of pids) if (!prorations.has(id)) return failed();
  for (const id of fids) if (!funding.has(id)) return failed();
  for (const id of rids) if (!reservations.has(id)) return failed();
  for (const id of aids) if (!applications.has(id)) return failed();
  for (const row of funding.values()) if (row.sourceApplicationId) {
    const ancestor = applications.get(row.sourceApplicationId), root = ancestor?.fundingId ? funding.get(ancestor.fundingId) : undefined;
    if (!ancestor || ancestor.targetInvoiceId !== row.sourceInvoiceId || root?.sourcePaymentId !== row.sourcePaymentId) return failed();
  }
  for (const [id] of funding) {
    const ancestors = new Set<string>();let next: string | undefined = id;
    while (next) {
      if (ancestors.has(next)) return failed();ancestors.add(next);
      const original: ProrationFinancialParents | undefined = funding.get(next);
      const previous: ProrationFinancialParents | undefined = original?.sourceApplicationId ? applications.get(original.sourceApplicationId) : undefined;
      next = previous?.fundingId ?? undefined;
    }
  }
  // A merchant's source invoice may contain other parties. Match its exact
  // immutable profile pair rather than broadening to every invoice payment.
  const linked = linkedInvoices.size ? sql`(${sql.join([...linkedInvoices].flatMap(([invoiceId, owners]) => [...owners].map(profileId => sql`(r.invoice_id=${invoiceId}::uuid and r.merchant_profile_id=${profileId}::uuid)`)), sql` or `)})` : sql`false`;
  const allPayments = await read("commercial_payment_attestations", col("r", "payment_id"), attestationParents, attestationFrom, sql`(${invoiceSeed} or ${linked})`, sql`original_payment.invoice_id=r.invoice_id`);
  for (const row of allPayments) paymentIds.add(row.id);
  await read("commercial_refund_attestations", col("r", "refund_id"), sql`jsonb_build_object('refundId',r.refund_id,'paymentId',r.payment_id,'invoiceId',payment.invoice_id,'profileId',payment.merchant_profile_id)`,
    sql`commercial_refund_attestations r join commercial_payment_attestations payment on payment.payment_id=r.payment_id left join refunds original_refund on original_refund.id=r.refund_id`,
    oneOf(col("r", "payment_id"), paymentIds), sql`original_refund.payment_id=r.payment_id and original_refund.invoice_id=payment.invoice_id`);
  await read("commercial_fee_attestations", col("r", "id"), sql`jsonb_build_object('paymentId',r.payment_id,'invoiceId',payment.invoice_id,'profileId',payment.merchant_profile_id,'originalRemittanceId',r.original_remittance_id)`,
    sql`commercial_fee_attestations r join commercial_payment_attestations payment on payment.payment_id=r.payment_id`, oneOf(col("r", "payment_id"), paymentIds));
  await read("invoice_credit_releases", col("r", "reservation_id"), sql`jsonb_build_object('reservationId',r.reservation_id,'fundingId',f.id,'sourceProrationId',f.proration_id,'profileId',owner.profile_id,'sourceInvoiceId',f.source_invoice_id,'creditNoteId',f.credit_note_id)`,
    sql`invoice_credit_releases r join invoice_credit_reservations reservation on reservation.id=r.reservation_id join invoice_credit_funding f on f.id=reservation.funding_id join subscription_prorations owner on owner.id=f.proration_id`, oneOf(col("r", "reservation_id"), rids),
    sql`not exists(select 1 from invoice_credit_applications applied where applied.reservation_id=r.reservation_id)`);
  for (const [table, note] of [["subscription_proration_principal", false], ["subscription_proration_credit_uses", true]] as const) await read(table, col("r", "id"), note
    ? sql`jsonb_build_object('prorationId',r.proration_id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id,'creditNoteId',r.credit_note_id)`
    : sql`jsonb_build_object('prorationId',r.proration_id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id,'sourcePaymentId',r.source_payment_id,'sourceApplicationId',r.source_application_id)`,
    sql`${sql.identifier(table)} r join subscription_prorations owner on owner.id=r.proration_id`, oneOf(col("r", "proration_id"), pids),
    note ? sql`exists(select 1 from invoice_credit_funding f where f.credit_note_id=r.credit_note_id)` : sql`true`);
  const feeSeed = scope.kind === "invoice" ? oneOf(col("r", "invoice_id"), ids) : scope.kind === "merchant_profile" ? oneOf(col("r", "merchant_profile_id"), ids) : oneOf(col("owner", "subscription_id"), ids);
  const duties = await read("agreement_fee_duties", col("r", "invoice_id"), sql`jsonb_build_object('invoiceId',r.invoice_id,'prorationId',r.acceptance_id,'subscriptionId',owner.subscription_id,'profileId',r.merchant_profile_id)`,
    sql`agreement_fee_duties r left join subscription_prorations owner on owner.id=r.acceptance_id`, sql`(${feeSeed} or ${oneOf(col("r", "acceptance_id"), pids)})`,
    sql`owner.id is not null and owner.profile_id=r.merchant_profile_id and owner.debit_invoice_id=r.invoice_id`);
  for (const row of duties) dutyIds.add(row.id);
  for (const [table, key, extra] of [["agreement_fee_credit_assignments", "application_id", "applicationId"], ["agreement_fee_cash_assignments", "payment_id", "paymentId"],
    ["agreement_fee_eligibility", "invoice_id", "invoiceId"], ["agreement_fee_remittances", "id", "originalRemittanceId"]] as const) await read(table, col("r", key),
    table === "agreement_fee_remittances" ? sql`jsonb_build_object('invoiceId',r.invoice_id,'profileId',duty.merchant_profile_id,'prorationId',duty.acceptance_id,'originalRemittanceId',r.original_remittance_id)`
      : sql`jsonb_build_object('invoiceId',r.invoice_id,'profileId',duty.merchant_profile_id,'prorationId',duty.acceptance_id,${extra}::text,${col("r", key)})`,
    sql`${sql.identifier(table)} r join agreement_fee_duties duty on duty.invoice_id=r.invoice_id
      ${table === "agreement_fee_credit_assignments" ? sql`left join invoice_credit_applications consideration on consideration.reservation_id=r.application_id`
        : table === "agreement_fee_cash_assignments" ? sql`left join payments consideration on consideration.id=r.payment_id` : sql``}`,
    oneOf(col("r", "invoice_id"), dutyIds), table === "agreement_fee_credit_assignments" || table === "agreement_fee_cash_assignments" ? sql`consideration.invoice_id=r.invoice_id` : sql`true`);
  for (const [table, key] of [["subscription_proration_cash_confirmations", "payment_id"], ["subscription_proration_credit_confirmations", "application_id"]] as const) await read(table, col("r", key),
    key === "payment_id" ? sql`jsonb_build_object('invoiceId',r.invoice_id,'prorationId',r.proration_id,'profileId',owner.profile_id,'paymentId',r.payment_id,'providerObservationId',r.provider_observation_id,'externalAttestationId',r.external_attestation_id)`
      : sql`jsonb_build_object('invoiceId',r.invoice_id,'prorationId',r.proration_id,'profileId',owner.profile_id,'applicationId',r.application_id)`,
    sql`${sql.identifier(table)} r join subscription_prorations owner on owner.id=r.proration_id
      ${key === "payment_id" ? sql`left join payments consideration on consideration.id=r.payment_id
        left join merchant_payment_observations observation on observation.id=r.provider_observation_id
        left join commercial_payment_attestations external_receipt on external_receipt.payment_id=r.external_attestation_id`
        : sql`left join invoice_credit_applications consideration on consideration.reservation_id=r.application_id`}`,
    oneOf(col("r", "proration_id"), pids), key === "payment_id" ? sql`owner.debit_invoice_id=r.invoice_id and consideration.invoice_id=r.invoice_id
      and ((r.external_attestation_id is null and observation.payment_id=r.payment_id) or (r.provider_observation_id is null and external_receipt.payment_id=r.payment_id and external_receipt.invoice_id=r.invoice_id and external_receipt.merchant_profile_id=owner.profile_id))`
      : sql`owner.debit_invoice_id=r.invoice_id and consideration.invoice_id=r.invoice_id`);
  // Select card history from actual accepted targets, including hosted reads
  // with no stored-method mandate/attempt. A seller never inherits every
  // payment merely because an original source invoice contains their party.
  const cardScope = (invoice: SQL) => scope.kind === "invoice" ? sql`(${oneOf(col("owner", "id"), pids)} or ${oneOf(invoice, ids)})` : oneOf(col("owner", "id"), pids);
  const targetMatches = sql`owner.id is not null and owner.debit_invoice_id=target_invoice.id and target_invoice.source_type='subscription'
    and target_invoice.source_id=${source("owner")}`;
  await read("subscription_proration_payment_protocols", col("r", "payment_id"),
    sql`jsonb_build_object('paymentId',r.payment_id,'invoiceId',r.invoice_id,'prorationId',r.proration_id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id)`,
    sql`subscription_proration_payment_protocols r left join subscription_prorations owner on owner.id=r.proration_id
      left join invoices target_invoice on target_invoice.id=r.invoice_id left join payments cash on cash.id=r.payment_id
      left join merchant_payment_requests request on request.payment_id=r.payment_id`, cardScope(col("r", "invoice_id")),
    sql`${targetMatches} and cash.invoice_id=r.invoice_id and request.provider_invoice_ref=r.invoice_id`);
  await read("subscription_proration_card_mandates", col("r", "proration_id"),
    sql`jsonb_build_object('prorationId',r.proration_id,'invoiceId',r.invoice_id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id,'paymentMethodId',r.payment_method_id)`,
    sql`subscription_proration_card_mandates r left join subscription_prorations owner on owner.id=r.proration_id
      left join invoices target_invoice on target_invoice.id=r.invoice_id`, cardScope(col("r", "invoice_id")),
    sql`${targetMatches} and r.accepted_quote_digest=owner.accepted_quote_digest and r.method->>'id'=r.payment_method_id::text`);
  await read("subscription_proration_card_attempts", col("r", "payment_id"),
    sql`jsonb_build_object('paymentId',r.payment_id,'invoiceId',r.invoice_id,'prorationId',r.proration_id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id,'paymentMethodId',mandate.payment_method_id)`,
    sql`subscription_proration_card_attempts r left join subscription_prorations owner on owner.id=r.proration_id
      left join invoices target_invoice on target_invoice.id=r.invoice_id left join payments cash on cash.id=r.payment_id
      left join subscription_proration_card_mandates mandate on mandate.proration_id=r.proration_id
      left join subscription_proration_payment_protocols protocol on protocol.payment_id=r.payment_id`, cardScope(col("r", "invoice_id")),
    sql`${targetMatches} and cash.invoice_id=r.invoice_id and mandate.invoice_id=r.invoice_id and protocol.invoice_id=r.invoice_id and protocol.proration_id=r.proration_id
      and r.provider_request->>'paymentAttemptId'=r.payment_id::text and r.provider_request->>'invoiceId'=r.invoice_id::text`);
  await read("subscription_proration_card_jobs", col("r", "job_id"),
    sql`jsonb_build_object('jobId',r.job_id,'prorationId',r.proration_id,'invoiceId',mandate.invoice_id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id)`,
    sql`subscription_proration_card_jobs r left join subscription_proration_card_mandates mandate on mandate.proration_id=r.proration_id
      left join subscription_prorations owner on owner.id=r.proration_id left join invoices target_invoice on target_invoice.id=mandate.invoice_id`, cardScope(col("mandate", "invoice_id")),
    sql`${targetMatches} and r.original_task->>'prorationId'=r.proration_id::text and r.original_task->>'originalJobId'=r.job_id::text
      and r.original_task->>'acceptedQuoteDigest'=mandate.accepted_quote_digest`);
  // The protocol is mandatory original creation evidence for either saved or
  // hosted recovery. Current method/contact/account values cannot replace it.
  const readJoins = sql`left join payments cash on cash.id=original_read.payment_id left join invoices target_invoice on target_invoice.id=cash.invoice_id
    left join subscription_prorations owner on owner.debit_invoice_id=target_invoice.id
    left join subscription_proration_payment_protocols protocol on protocol.payment_id=cash.id`;
  const readMatches = sql`${targetMatches} and protocol.invoice_id=target_invoice.id and protocol.proration_id=owner.id
    and original_read.admission->'payload'->>'readId'=original_read.id::text
    and original_read.admission->'payload'->>'paymentId'=cash.id::text and original_read.admission->'payload'->>'prorationId'=owner.id::text`;
  await read("subscription_proration_card_reads", col("r", "id"),
    sql`jsonb_build_object('readId',r.id,'paymentId',r.payment_id,'invoiceId',cash.invoice_id,'prorationId',owner.id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id)`,
    sql`subscription_proration_card_reads r left join subscription_proration_card_reads original_read on original_read.id=r.id ${readJoins}`,
    cardScope(col("cash", "invoice_id")), readMatches);
  for (const [table, opposite] of [["subscription_proration_card_read_finishes", "subscription_proration_card_read_stops"],
    ["subscription_proration_card_read_stops", "subscription_proration_card_read_finishes"]] as const) await read(table, col("r", "read_id"),
    sql`jsonb_build_object('readId',r.read_id,'paymentId',original_read.payment_id,'invoiceId',cash.invoice_id,'prorationId',owner.id,'subscriptionId',owner.subscription_id,'profileId',owner.profile_id)`,
    sql`${sql.identifier(table)} r left join subscription_proration_card_reads original_read on original_read.id=r.read_id ${readJoins}`,
    cardScope(col("cash", "invoice_id")), sql`${readMatches} and r.proof->'payload'->>'readId'=original_read.id::text
      and r.proof->'payload'->>'paymentId'=cash.id::text and r.proof->'payload'->>'prorationId'=owner.id::text
      and not exists(select 1 from ${sql.identifier(opposite)} other_receipt where other_receipt.read_id=r.read_id)`);
  if (invalid || !bounded()) return failed();
  for (const entry of entries.values()) {
    for (const name of ["prorationId", "sourceProrationId", "targetProrationId"] as const) { const originalId = entry.parents[name];if (originalId && !prorations.has(originalId)) return failed(); }
    if (entry.parents.sourceApplicationId && !applications.has(entry.parents.sourceApplicationId)) return failed();
    if (entry.table === "subscription_proration_credit_uses" && ![...funding.values()].some(original => original.creditNoteId === entry.parents.creditNoteId)) return failed();
    if (entry.parents.originalRemittanceId) {
      const original = entries.get(`${entry.table}:${entry.parents.originalRemittanceId}`);
      if (!original || original.parents.invoiceId !== entry.parents.invoiceId || original.parents.paymentId !== entry.parents.paymentId || original.parents.profileId !== entry.parents.profileId) return failed();
    }
    if (entry.family === "card") {
      if (!entry.parents.prorationId || !entry.parents.invoiceId) return failed();
      if (entry.table === "subscription_proration_card_mandates" && ![...entries.values()].some(child => child.table === "subscription_proration_card_jobs" && child.parents.prorationId === entry.parents.prorationId)) return failed();
      if (entry.table === "subscription_proration_card_jobs" || entry.table === "subscription_proration_card_attempts") {
        if (!entries.has(`subscription_proration_card_mandates:${entry.parents.prorationId}`)) return failed();
      }
      if (["subscription_proration_card_attempts", "subscription_proration_card_reads", "subscription_proration_card_read_finishes", "subscription_proration_card_read_stops"].includes(entry.table)) {
        if (!entry.parents.paymentId || !entries.has(`subscription_proration_payment_protocols:${entry.parents.paymentId}`)) return failed();
      }
      if (entry.table === "subscription_proration_card_read_finishes" || entry.table === "subscription_proration_card_read_stops") {
        if (!entry.parents.readId || !entries.has(`subscription_proration_card_reads:${entry.parents.readId}`)) return failed();
      }
    }
  }
  return { version: 1, entries: [...entries.values()].sort((left, right) => left.table.localeCompare(right.table) || left.id.localeCompare(right.id)), incomplete: false };
}
