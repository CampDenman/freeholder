// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product-wide findability over live rows (C11.14). Each source owns its
// ILIKE, grant module and href; the handler never concatenates SQL.
import { sql, type SQLWrapper } from "drizzle-orm";
import type { Actor, Tx } from "@/core/service";

export interface SearchHit {
  kind: string;
  id: string;
  title: string;
  href: string;
  snippet: string | null;
  contactId: string | null;
  module: string;
}

export interface SearchSource {
  kind: string;
  /** Module label for the result; authorization uses readService. */
  module: string;
  /** Existing scoped query that authorizes reading this source. */
  readService: string;
  /** Physical tables this source is the findability for. */
  tables: readonly string[];
  search: (query: {
    tx: Tx;
    actor: Actor;
    pattern: string;
    limit: number;
  }) => Promise<SearchHit[]>;
}

const sources: SearchSource[] = [];

export function registerSearchSource(source: SearchSource): void {
  const existing = sources.find((item) => item.kind === source.kind);
  if (existing) return;
  sources.push(source);
}

export function searchSources(): readonly SearchSource[] {
  return sources;
}

/** Escape `%`, `_` and `\` so a user query is a literal, not a wildcard. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function ilikeContains(value: string): string {
  return `%${escapeIlike(value)}%`;
}

export function matchesIlike(column: SQLWrapper, pattern: string) {
  return sql`${column} ilike ${pattern} escape ${"\\"}`;
}

export function clipSnippet(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length <= 140 ? trimmed : `${trimmed.slice(0, 137)}…`;
}

/**
 * Contact-FK tables that are not owner-facing search hits, each with the
 * reason. Join tables, hashes, ciphertext and operational rows stay out.
 * Completeness is asserted in `tests/core/c11-14-search.test.ts`.
 */
export const SEARCH_TABLE_OPT_OUTS: Record<string, string> = {
  merchant_collection_configuration: "Private verified platform configuration; reached through its scoped financial service.",
  invoice_merchant_collections: "Original public commercial copies and private route/tax receipts inherit allocation ownership; authorized invoice projections only.",
  merchant_payment_routes: "Private one-payment-to-original-merchant binding; never a separate search hit.",
  merchant_agreement_payment_routes: "Private original agreement/charge namespace and automatic-renewal receipt lineage, accessed through scoped money services.",
  merchant_payment_observations: "Append-only provider financial evidence, not searchable personal content.",
  merchant_payment_event_receipts: "Private immutable authenticated financial facts, including unmatched provider attempts; retained for reconciliation and never included in content search.",
  merchant_fee_refunds: "Original provider commission refund operations; scoped money recovery only.",
  merchant_fee_observations: "Immutable actual commission-refund financial acknowledgements, retained separately from logical reconciliation and excluded from content search.",
  invoice_market_policies: "Original merchant ownership and private financial routing; read through authorized invoice documents, never as separate search hits.",
  invoice_merchant_allocations: "Original private seller portions of an invoice; money facts use authorized invoice and payout services, never searchable contact hits.",
  subscription_market_policies: "Frozen merchant agreement identity and private routing; reached through authorized agreements.",
  media_object_writes:"Private physical-operation receipts; inspect through human storage recovery, not global search.",
  media_uploads:"Private original upload reservations and ownership; accessed through their authorized upload capability.",
  media_objects:"Private physical ownership pointers; the authorized library asset is the searchable record.",
  media_multipart_resources:"Private original multipart resource identities; inspect through human storage recovery.",
  import_reader_ownership_receipts: "Private keyed source-reader ownership proof; source digests, contact pointers and erased-reimport fences are never search hits.",
  mail_record_subjects: "Private ownership join; mail status uses its own scoped service and receipt identities are not searchable titles.",
  contact_relationships:
    "Join table of two contacts; find each person through the contact source.",
  customer_magic_links:
    "Credential bearer; hashes are not searchable titles.",
  merge_candidates: "Derived review metadata, not a record an owner looks up.",
  timeline_events: "Operational append-only log; find the subject instead.",
  bookings:
    "No searchable title; find the person, then their appointments.",
  booking_participants: "Join table on a booking.",
  booking_waitlist: "Queue position, not a titled record.",
  site_chat_sessions: "Token-hash session row; the conversation is the hit.",
  keyword_rule_events: "Operational match log.",
  sms_compliance_events: "Operational compliance log.",
  consent_records: "Preference flags, not titled records.",
  media_consents: "Consent evidence, reached through the work it covers.",
  notifications: "Fan-out copies of events already attached to a subject.",
  notification_preferences: "Per-contact settings, not titled records.",
  notification_digests: "Operational digest batches.",
  device_tokens: "Push credentials.",
  segment_members: "Join table.",
  contact_score_awards: "Scoring events; find the contact.",
  entitlement_grants: "Join/grant rows.",
  pass_balances: "Ledger amounts, not titled records.",
  content_unlocks: "Operational unlock rows.",
  contact_imports: "Import job, not a customer record.",
  contact_import_rows: "Staging rows for an import.",
  tax_exemptions: "Certificate metadata hanging off invoicing.",
  payment_provider_customers: "Provider customer ids, not titled records.",
  payment_methods: "Tokenised instruments; never search ciphertext.",
  quote_partner_links: "Bearer share links.",
  gallery_sessions: "Bearer session; hashes are not searchable.",
  gallery_guests: "Join table of gallery access.",
  gallery_rounds: "Proofing workflow rows.",
  gallery_selections: "Proofing picks hanging off a gallery.",
  gallery_access_logs: "Operational access log.",
  project_testimonials: "Quotes on a case study, not a first-class lookup.",
  contributions: "Inbound triage queue, not a titled customer record.",
  form_submissions: "Find the contact; the submission is on their timeline.",
  assessment_responses: "Find the contact; what they were told is on their timeline.",
  runs: "Operational agent/automation execution log.",
  notification_settings: "Per-contact notification flags, not a titled record.",
  paywall_meter_counters: "Meter ticks, not a document an owner looks up.",
  messaging_windows: "Quiet-hours configuration.",
  analytics_events: "Analytics facts; find the person or the page instead.",
  customer_balance_accounts: "Ledger balances hanging off invoicing.",
  invoice_schedules: "Recurring invoice configuration, not a titled invoice.",
  back_in_stock_subscriptions: "Wait-list join rows.",
  carts: "In-progress checkout rows.",
  wishlists: "Join table of saved products.",
  pod_jobs: "Vendor fulfillment jobs; find from print admin or the catalog order.",
  return_requests: "Workflow rows hanging off an order.",
  coupon_redemptions: "Join table of a coupon to a contact.",
  gift_cards: "Tokenised store credit; the code is not a search title.",
  gift_card_redemptions: "Join table.",
  event_registrations: "Join table of a contact to an event.",
  newsletter_subscriptions: "List membership, not a titled record.",
  broadcast_recipients: "Fan-out rows for a send.",
  rental_agreements: "Find from hire; the agreement is the document, not a search hit.",
  time_entries: "Time against a project; find the project.",
  reviews: "Find the contact or the listing they reviewed.",
  blog_reader_comments:
    "Untitled reader contributions; review through the scoped blog moderation queue, not global contact search.",
  review_requests: "Solicitation workflow.",
  contact_stages: "Join table of a contact to a pipeline stage.",
  advertisers: "Ad-account counterparties.",
  ad_campaigns: "Campaign configuration; find from ads admin.",
  shared_links: "Bearer share URLs.",
  popup_events: "Operational popup impressions/submits.",
  document_shares: "Bearer share rows.",
  document_access_logs: "Operational access log.",
  automation_contact_state: "Per-contact automation cursor.",
  knowledge_gaps: "Assistant gap log, not a customer record.",
  social_interactions: "Inbound social events.",
  loyalty_accounts: "Points balances, not titled records.",
  affiliate_codes: "Referral codes; find the contact.",
  attribution_touches: "Attribution facts.",
  referral_invitations: "Outbound invite rows.",
  commission_events: "Ledger events.",
  payout_lines: "Payout composition rows.",
  affiliate_tax_profiles: "Tax profile attached to an affiliate.",
  community_members: "Join table of a contact to a room.",
  community_join_requests:
    "Membership queue, not a titled record an owner looks up.",
  voice_video_joins: "Join table of a contact to a voice/video room.",
  voice_video_artifacts: "Recording/transcript blobs; find the room, not search.",
};
