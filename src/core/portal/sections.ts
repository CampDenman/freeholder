// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a signed-in customer can see of their own relationship
// (MASTER.md §43 C8.11).
//
// C8.11's requirement is one clause long and decides the whole shape: the
// portal shows quotes, contracts, invoices, bookings, orders, rentals,
// projects and messages **"using the same services as admin"**. Not similar
// services. The same ones.
//
// That is achievable because those services already take a `contactId` — they
// were written so an owner could ask "what does this person have?", and a
// customer asking the same question about themselves is the identical query
// with the identical filter. Writing a second read path per domain would have
// produced eight more places for "what does this person have" to drift.
//
// So this is a registry, not a list of imports. Core may not import a module
// (§11), and a portal that named its rooms would need editing every time one
// arrived. Each module registers what it can show at import time, exactly as
// it registers its merge references and its privacy sources.
//
// The consequence worth stating: a room is absent because nothing registered
// it, never because the portal forgot. Subscriptions and passes (C9.13–C9.16)
// and referral earnings (C9.09–C9.10) will appear here when those modules
// exist, without this file or any page changing.
import type { ServiceContext } from "@/core/service";

/**
 * One thing the customer has, flattened to what a list can show.
 *
 * Deliberately thin. A portal list needs a name, a state, a date and a way in;
 * everything else belongs on the record's own page, where the module that owns
 * it decides how to present it.
 */
export type PortalRecord = {
  id: string;
  title: string;
  /** A stable state token the room's copy maps to words. */
  status: string | null;
  /** Null where a record genuinely has no date yet — a draft, an unsent quote. */
  at: Date | null;
  /**
   * Where the customer opens it, or null.
   *
   * Null is the common case today and is a deliberate refusal rather than a
   * gap. Most customer-facing record pages are reached by a view token, and a
   * token is a credential: `quotes.list` names its columns one by one
   * specifically so `view_token` cannot ride along into "every list, log and
   * screenshot". A portal that put those tokens in a list would undo that.
   *
   * So the room shows the record and its state, the emailed link still opens
   * it, and a session-authenticated record page is a per-module piece of work
   * rather than something this registry can invent.
   */
  href: string | null;
  amountMinor?: number | null;
  currency?: string | null;
};

export type PortalSection = {
  /** URL segment and i18n suffix: "quotes" → /portal/quotes, portal.room.quotes. */
  key: string;
  /** Where it sits in the customer's own sense of importance, low first. */
  order: number;
  /**
   * Read this contact's records **through the module's own service**.
   *
   * Elevation is `ctx.callAsSystem` and the contact id is resolved from the
   * session before this is called, never taken from a request — so the query
   * is the admin one, run on behalf of the only person entitled to the answer.
   */
  load: (ctx: ServiceContext, contactId: string, limit: number) => Promise<PortalRecord[]>;
};

const sections = new Map<string, PortalSection>();

/** A module claims a room at import time; nothing else may. */
export function registerPortalSection(section: PortalSection): void {
  const existing = sections.get(section.key);
  if (existing && existing.load !== section.load) {
    throw new Error(
      `two modules both register the portal room "${section.key}"; one of them is wrong`,
    );
  }
  sections.set(section.key, section);
}

/** Every registered room, in the order a customer would look for them. */
export function portalSections(): readonly PortalSection[] {
  return [...sections.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

export function portalSection(key: string): PortalSection | null {
  return sections.get(key) ?? null;
}

/** Test seam. Production never calls this. */
export function resetPortalSections(): void {
  sections.clear();
}
