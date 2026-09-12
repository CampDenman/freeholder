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
  /** Grant module that must be viewable for hits from this source. */
  module: string;
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
  data_requests: "Privacy-rights workflow, not a findability surface.",
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
  runs: "Operational agent/automation execution log.",
  notification_settings: "Per-contact notification flags, not a titled record.",
  paywall_meter_counters: "Meter ticks, not a document an owner looks up.",
  messaging_windows: "Quiet-hours configuration.",
  analytics_events: "Analytics facts; find the person or the page instead.",
  customer_balance_accounts: "Ledger balances hanging off invoicing.",
  invoice_schedules: "Recurring invoice configuration, not a titled invoice.",
  back_in_stock_subscriptions: "Wait-list join rows.",
  price_lists: "Catalog pricing configuration.",
  suppliers: "Procurement counterparties; find them from catalog, not search.query.",
  carts: "In-progress checkout rows.",
  wishlists: "Join table of saved products.",
  orders: "Looked up from the orders list; settlement is on the invoice.",
  marketplace_orders:
    "Staged channel orders; find from marketplace admin or the invoice.",
  return_requests: "Workflow rows hanging off an order.",
  coupon_redemptions: "Join table of a coupon to a contact.",
  gift_cards: "Tokenised store credit; the code is not a search title.",
  gift_card_redemptions: "Join table.",
  event_registrations: "Join table of a contact to an event.",
  newsletter_subscriptions: "List membership, not a titled record.",
  broadcast_recipients: "Fan-out rows for a send.",
  contract_documents: "Find from agreements; signing tokens stay off search.",
  rental_agreements: "Find from hire; the agreement is the document, not a search hit.",
  time_entries: "Time against a project; find the project.",
  reviews: "Find the contact or the listing they reviewed.",
  review_requests: "Solicitation workflow.",
  contact_stages: "Join table of a contact to a pipeline stage.",
  advertisers: "Ad-account counterparties.",
  ad_campaigns: "Campaign configuration; find from ads admin.",
  shared_links: "Bearer share URLs.",
  popup_events: "Operational popup impressions/submits.",
  document_shares: "Bearer share rows.",
  document_access_logs: "Operational access log.",
  automation_contact_state: "Per-contact automation cursor.",
  subscriptions: "Billing membership; find from subscriptions or the invoice.",
  knowledge_gaps: "Assistant gap log, not a customer record.",
  social_interactions: "Inbound social events.",
  loyalty_accounts: "Points balances, not titled records.",
  affiliate_codes: "Referral codes; find the contact.",
  attribution_touches: "Attribution facts.",
  referral_invitations: "Outbound invite rows.",
  commission_events: "Ledger events.",
  payout_lines: "Payout composition rows.",
  affiliate_tax_profiles: "Tax profile attached to an affiliate.",
  gift_registries: "Find from gifts admin; not mixed into search.query.",
  community_members: "Join table of a contact to a room.",
  community_join_requests:
    "Membership queue, not a titled record an owner looks up.",
  voice_video_joins: "Join table of a contact to a voice/video room.",
  voice_video_artifacts: "Recording/transcript blobs; find the room, not search.",
};
