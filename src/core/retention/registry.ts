// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded purgeable stores (C11.14). A kind is a policy key, not a deleted_at
// column, and legal/audit rows stay out of the clock.
import { and, asc, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/core/db";

export const RETENTION_PURGE_BATCH = 500;

export interface RetentionPurgeArgs {
  cutoff: Date;
  exceptContactIds: readonly string[];
  /** Clock the row ages on. Defaults to `created_at`. */
  aged?: SQL | PgColumn;
  extra?: SQL;
}

export interface RetentionSource {
  kind: string;
  /** Physical tables this kind is the TTL for. */
  tables: readonly string[];
  /** Privacy-rights scope honoured as a legal hold. */
  privacyScope: string;
  purge: (args: RetentionPurgeArgs) => Promise<number>;
}

const sources: RetentionSource[] = [];

export function registerRetentionSource(source: RetentionSource): void {
  const existing = sources.find((item) => item.kind === source.kind);
  if (existing) return;
  sources.push(source);
}

export function retentionSources(): readonly RetentionSource[] {
  return sources;
}

type ContactAgedTable = PgTable & {
  id: PgColumn;
  createdAt: PgColumn;
  contactId: PgColumn;
};

/** Delete rows older than the cutoff unless a privacy exception names the contact. */
export async function purgeAgedContactRows(
  table: ContactAgedTable,
  args: RetentionPurgeArgs,
): Promise<number> {
  const aged = args.aged ?? table.createdAt;
  const conditions: SQL[] = [
    sql`${aged} < ${args.cutoff.toISOString()}::timestamptz`,
  ];
  if (args.extra) conditions.push(args.extra);
  if (args.exceptContactIds.length > 0) {
    const hold = or(
      isNull(table.contactId),
      notInArray(table.contactId, [...args.exceptContactIds]),
    );
    if (hold) conditions.push(hold);
  }
  const where = and(...conditions);
  let purged = 0;
  for (;;) {
    const batch = await db()
      .select({ id: table.id })
      .from(table)
      .where(where)
      .orderBy(asc(table.id))
      .limit(RETENTION_PURGE_BATCH);
    if (batch.length === 0) break;
    const deleted = await db()
      .delete(table)
      .where(
        and(
          inArray(
            table.id,
            batch.map((row) => row.id),
          ),
          where,
        ),
      )
      .returning({ id: table.id });
    purged += deleted.length;
    if (batch.length < RETENTION_PURGE_BATCH) break;
  }
  return purged;
}

/**
 * Contact-FK tables that must not age out on a product TTL. Completeness is
 * asserted in `tests/core/c11-14-retention.test.ts`.
 */
export const RETENTION_TABLE_OPT_OUTS: Record<string, string> = {
  merchant_payment_dispatch_finishes: "Immutable actual original caller completion; money outcome remains independent and is reconciled through the original invoice.",
  merchant_payment_dispatch_stops: "Exact original hosting stop reviews; private operational proof cannot be an age sweep or contact search.",
  merchant_payment_resource_bindings: "Original physical acknowledgements or explicit provider request-log review, retained with the existing invoice owner. Not a second contact identity.",
  merchant_payment_dispatches: "Immutable original payment dispatch admission and full-request digest; actual original effects require explicit provider recovery, never an age sweep or contact search.",
  merchant_payment_creation_refusals: "Append-only actual per-dispatch provider refusal evidence, retained with the payment rather than content search or TTL deletion.",
  merchant_payment_requests: "Immutable original provider metadata references; current invoice contact remains ownership authority and money history retains the opaque witness.",
  merchant_payment_retirement_acks: "Append-only original provider cancellation acknowledgements, private financial recovery evidence rather than searchable content or disposable TTL data.",
  merchant_payment_terminal_receipts: "Original provider terminal-zero-money proof retained with its payment; no human absence attestation or time-based deletion.",
  merchant_tax_profiles: "Original tax business and retained financial proof; holds and explicit minimization use commerce.merchantTax, never an age-based purge.",
  booking_market_policies: "Original accepted member commercial policy and private contact owner; controlled by shared booking/money and privacy services.",
  booking_merchant_scopes: "Private original booking account and tax destination witness; personal copies minimized by original buyer and merchant rights, never content-search data.",
  booking_commercial_sources: "Immutable original booking offering/product/seller provenance, private operational history rather than content search or age-sweep data.",
  invoice_merchant_scopes: "Immutable original single-source merchant namespace and opaque tax receipt, private financial provenance retained with the invoice.",
  merchant_invoice_payment_routes: "Immutable original single-source charge/commission binding, retained with actual money and excluded from content search.",
  merchant_collection_configuration: "Current verified payment configuration has no natural-person identity; explicit owner configuration replaces it.",
  invoice_merchant_collections: "Original invoice routes and tax receipts are retained money facts; personal commercial copies minimize through members.merchantIdentity and inherit named holds.",
  merchant_payment_routes: "Immutable original merchant money binding, retained with its payment rather than age-purged.",
  merchant_agreement_payment_routes: "Immutable original agreement payment money and namespace; retained with its actual provider evidence.",
  merchant_payment_observations: "Append-only actual provider financial evidence, retained with original money and never deleted by an age sweep.",
  merchant_payment_event_receipts: "Private immutable authenticated financial facts, including unmatched provider attempts; retained for reconciliation and never included in content search.",
  merchant_fee_refunds: "Original commission refund money and unknown provider outcomes require explicit reconciliation, never timed deletion.",
  merchant_fee_observations: "Immutable actual commission-refund financial acknowledgements, retained separately from logical reconciliation and excluded from content search.",
  merchant_refund_observation_captures: "Original financial occurrence evidence survives repeated state; no age purge may invalidate refund or erasure debt.",
  merchant_refund_state_reads: "Original bank-read and caller proof remains with its money; no TTL or elapsed-time absence inference.",
  merchant_refund_state_read_finishes: "Actual caller completion remains independently retained with its original bank read and named financial holds.",
  legacy_bank_read_stops: "Original stopped-reader receipts and actual partial financial facts remain with their original read and financial owner.",
  legacy_bank_current_receipts: "Original legacy bank current receipts remain with their financial source; newer facts invalidate freshness without deleting old proof.",
  legacy_bank_reads: "Authentic original refund read tickets remain with their financial owner; unresolved callers cannot be purged by age.",
  legacy_bank_read_facts: "Actual historical bank/cash facts and unassigned-resource debt remain with original money and named holds; no TTL cleanup.",
  legacy_bank_read_finishes: "Actual historical read finishes and complete fact inventories remain with original financial recovery evidence.",
  merchant_refund_current_receipts: "Original current-state proof remains with its refund history; later facts invalidate freshness without deleting earlier evidence.",
  order_commercial_parties: "Original order business and tax authority; catalog.orderCommercial honors named holds and minimizes identity, never an age-based purge.",
  invoice_market_policies: "Immutable issued-invoice terms; personal identity erasure and named holds use members.merchantIdentity, not an age-based policy purge.",
  invoice_merchant_allocations: "Immutable original invoice money and seller ownership; retained financial facts and contact merge use members.merchantIdentity, never an age-based purge.",
  subscription_market_policies: "Immutable agreement terms; personal identity erasure and named holds use members.merchantIdentity, not an age-based policy purge.",
  subscription_commercial_terms: "Accepted commercial evidence has no TTL; original agreement privacy and legal holds govern personal-destination minimization after actual provider work is quiescent.",
  media_uploads:"Original reservations survive unresolved physical work; guarded lifecycle and subject erasure own retirement.",
  media_objects:"Original object ownership survives unknown writes; guarded physical cleanup and privacy jobs remove it.",
  media_multipart_resources:"Original multipart resources survive timers; explicit original-provider retirement and subject erasure own cleanup.",
  media_object_writes: "Original physical-operation and retired-key receipts are not a TTL store. Privacy minimizes personal fields only after settled original cleanup; unresolved work keeps its erasure receipt pending.",
  import_reader_ownership_receipts: "Minimal source ownership and erasure fences have no product TTL; reader privacy/holds govern state and normalized merge witnesses preserve exact undo.",
  mail_record_subjects: "Mail receipt ownership follows the receipt; personal fields use the three mail retention kinds.",
  contact_relationships: "Join table of two contacts; not a TTL store.",
  customer_magic_links: "Credential bearer hashes; never a product TTL.",
  merge_candidates: "Derived review metadata for merge, not disposable content.",
  timeline_events: "Append-only operational log; not a user-content TTL.",
  bookings: "Appointment history is a legal/operational record, not notes TTL.",
  booking_participants: "Join table on a booking.",
  booking_waitlist: "Queue position hanging off a booking.",
  site_chat_sessions: "Bearer session; cascade-deleted with the conversation.",
  keyword_rule_events: "Operational match log.",
  sms_compliance_events: "Compliance evidence; legally retained.",
  consent_records: "Immutable consent evidence; legal/audit hold.",
  media_consents: "Immutable consent evidence; legal/audit hold.",
  data_requests: "Privacy-rights workflow; not a product TTL.",
  notifications: "Fan-out copies; already pruned by the notification sweeper.",
  notification_preferences: "Per-contact settings, not disposable content.",
  notification_digests: "Operational digest batches.",
  device_tokens: "Push credentials.",
  segment_members: "Join table.",
  contact_score_awards: "Scoring events hanging off the contact.",
  entitlement_grants: "Access grants; not a content TTL.",
  pass_balances: "Ledger amounts.",
  content_unlocks: "Operational unlock rows.",
  contact_imports: "Import job metadata.",
  contact_import_rows: "Staging rows for an import.",
  tax_exemptions: "Certificate metadata; accounting/tax hold.",
  payment_provider_customers: "Provider customer ids.",
  payment_methods: "Tokenised instruments; never a product TTL.",
  quote_partner_links: "Bearer share links hanging off a quote.",
  gallery_sessions: "Bearer session hanging off a gallery.",
  gallery_guests: "Join table of gallery access.",
  gallery_rounds: "Proofing workflow rows.",
  gallery_selections: "Proofing picks hanging off a gallery.",
  gallery_access_logs: "Operational access log.",
  project_testimonials: "Quotes on a case study.",
  contributions: "Inbound triage queue; not a user-owned store TTL.",
  form_submissions: "Form evidence hanging off the contact timeline.",
  assessment_responses: "Evidence of what somebody was told, and when; not disposable content.",
  runs: "Operational agent/automation execution log.",
  notification_settings: "Per-contact notification flags.",
  paywall_meter_counters: "Meter ticks, not disposable content.",
  messaging_windows: "Quiet-hours configuration.",
  analytics_events: "Analytics facts; already pruned at instance policy.",
  customer_balance_accounts: "Ledger balances; accounting hold.",
  invoice_schedules: "Recurring invoice configuration; accounting hold.",
  back_in_stock_subscriptions: "Wait-list join rows.",
  price_lists: "Catalog pricing configuration.",
  suppliers: "Procurement counterparties.",
  carts: "In-progress checkout rows.",
  wishlists: "Join table of saved products.",
  orders: "Commerce settlement; accounting/tax hold.",
  pod_jobs: "Order fulfillment and vendor retry identity; contact privacy handles erasure, not content TTL.",
  marketplace_orders: "Staged channel orders; accounting hold.",
  return_requests: "Workflow rows hanging off an order.",
  coupon_redemptions: "Join table of a coupon to a contact.",
  gift_cards: "Tokenised store credit.",
  gift_card_redemptions: "Join table.",
  event_registrations: "Join table of a contact to an event.",
  newsletter_subscriptions: "List membership, not disposable content.",
  broadcast_recipients: "Fan-out rows for a send.",
  contract_documents: "Agreements; contractual/legal hold.",
  rental_agreements: "Hire documents; contractual hold.",
  time_entries: "Time against a project; business work record.",
  reviews: "Published review evidence, not a notes-style TTL.",
  blog_reader_comments:
    "Published discussion and moderation history belongs to its page; page purge and cms.readerComments privacy erasure govern it, not a notes-style TTL.",
  review_requests: "Solicitation workflow.",
  contact_stages: "Join table of a contact to a pipeline stage.",
  advertisers: "Ad-account counterparties.",
  ad_campaigns: "Campaign configuration.",
  shared_links: "Bearer share URLs.",
  popup_events: "Operational popup impressions/submits.",
  document_shares: "Bearer share rows hanging off a document.",
  document_access_logs: "Operational access log.",
  automation_contact_state: "Per-contact automation cursor.",
  subscriptions: "Billing membership; accounting/tax hold.",
  knowledge_gaps: "Assistant gap log.",
  social_interactions: "Inbound social events hanging off a contact.",
  loyalty_accounts: "Points balances; ledger hold.",
  affiliate_codes: "Referral codes hanging off the contact.",
  attribution_touches: "Attribution facts.",
  referral_invitations: "Outbound invite rows.",
  commission_events: "Ledger events; accounting hold.",
  payout_lines: "Payout composition rows; accounting hold.",
  affiliate_tax_profiles: "Tax profile attached to an affiliate.",
  gift_registries: "Gift-registry membership, not a content TTL.",
  community_members: "Join table of a contact to a room.",
  community_join_requests: "Membership queue, not a post TTL.",
  voice_video_joins: "Join table of a contact to a voice/video room.",
  voice_video_artifacts: "Recording/transcript blobs hanging off a room.",
  voice_video_rooms: "Room membership is the join table; the room is not a notes-style TTL.",
  invoices: "Accounting records; legal/tax hold.",
  quotes: "Contractual quotes; not a product TTL.",
  projects: "Business work records.",
  galleries: "Client delivery archives.",
  deals: "CRM pipeline records.",
  documents: "Client documents; not a notes-style TTL.",
};
