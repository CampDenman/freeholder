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
