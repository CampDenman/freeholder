// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Decide what a visitor may see of a gated tree (MASTER.md §4.15, C9.15).
//
// The gated copy is either in the HTML or it is not. A teaser that ships the
// rest in a hidden div is not a paywall. Crawlers walk the same function as
// humans: there is no user-agent argument, because serving Google something
// a reader cannot get is cloaking.
import { and, eq, inArray } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { contactHasAccess } from "@/core/entitlements/access";
import { entitlementGrants, entitlements } from "@/core/entitlements/schema";
import type { Actor, Tx } from "@/core/service";
import {
  meterCounters,
  paywalls,
  type ContentKind,
  type PaywallAppliesTo,
} from "./schema";

export type PaywallRow = typeof paywalls.$inferSelect;

export type PaywallDecision = {
  gated: boolean;
  allowed: boolean;
  /** `all` shows every child, `preview` the configured lead-in, `none` the teaser only. */
  reveal: "all" | "preview" | "none";
  previewStrategy: "blocks" | "paragraphs" | "percent";
  previewValue: number;
  seoPolicy: "flexible_sampling" | "fully_gated" | null;
  paywallId: string | null;
  upsellPageId: string | null;
};

const OPEN: PaywallDecision = {
  gated: false,
  allowed: true,
  reveal: "all",
  previewStrategy: "blocks",
  previewValue: 0,
  seoPolicy: null,
  paywallId: null,
  upsellPageId: null,
};

export function normalizeSelector(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function appliesTo(
  applies: PaywallAppliesTo,
  kind: ContentKind,
  selector: string,
): boolean {
  if (applies.kind !== kind) return false;
  if (applies.selector === "*") return true;
  return normalizeSelector(applies.selector) === normalizeSelector(selector);
}

export function previewChildCount(
  total: number,
  strategy: "blocks" | "paragraphs" | "percent",
  value: number,
): number {
  if (total <= 0 || value <= 0) return 0;
  if (strategy === "percent") {
    return Math.min(total, Math.max(0, Math.ceil((total * Math.min(100, value)) / 100)));
  }
  return Math.min(total, value);
}

const TEXTUAL = new Set(["heading", "text"]);

export function selectPreviewChildren<T extends { type: string }>(
  children: T[],
  strategy: "blocks" | "paragraphs" | "percent",
  count: number,
): T[] {
  if (count <= 0) return [];
  if (strategy === "paragraphs") {
    // First N headings/text blocks, plus whatever sat in front of them (a
    // hero image). Nothing after the Nth — a later figure is the rest of
    // the article arriving for free. A tree with no textual blocks yields
    // an empty preview rather than dumping the chrome.
    let seen = 0;
    let last = -1;
    for (let i = 0; i < children.length; i++) {
      if (!TEXTUAL.has(children[i]!.type)) continue;
      last = i;
      seen += 1;
      if (seen >= count) break;
    }
    if (last < 0) return [];
    return children.slice(0, last + 1);
  }
  if (!Number.isFinite(count) || count >= children.length) return children;
  return children.slice(0, count);
}

async function actorContactId(tx: Tx, actor: Actor): Promise<string | null> {
  if (actor.kind !== "user") return null;
  const [found] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, actor.userId))
    .limit(1);
  return found?.id ?? null;
}

async function holdsRequired(
  tx: Tx,
  contactId: string,
  entitlementIds: string[],
  at: Date,
): Promise<boolean> {
  if (entitlementIds.length === 0) return false;
  const rows = await tx
    .select({
      startsAt: entitlementGrants.startsAt,
      endsAt: entitlementGrants.endsAt,
      used: entitlementGrants.used,
      quantity: entitlements.quantity,
      status: entitlementGrants.status,
    })
    .from(entitlementGrants)
    .innerJoin(entitlements, eq(entitlements.id, entitlementGrants.entitlementId))
    .where(
      and(
        eq(entitlementGrants.contactId, contactId),
        eq(entitlementGrants.status, "active"),
        eq(entitlements.status, "active"),
        inArray(entitlementGrants.entitlementId, entitlementIds),
      ),
    );
  return rows.some(
    (row) =>
      row.startsAt <= at &&
      (!row.endsAt || row.endsAt > at) &&
      (row.quantity === null || row.used < row.quantity),
  );
}

async function bumpMeter(
  tx: Tx,
  paywall: PaywallRow,
  contactId: string | null,
  anonId: string | null,
  at: Date,
): Promise<number> {
  const windowMs = paywall.meterWindowDays * 24 * 60 * 60 * 1000;
  const subject = contactId
    ? and(eq(meterCounters.paywallId, paywall.id), eq(meterCounters.contactId, contactId))
    : and(eq(meterCounters.paywallId, paywall.id), eq(meterCounters.anonId, anonId!));
  const [existing] = await tx.select().from(meterCounters).where(subject).limit(1);
  if (!existing) {
    await tx.insert(meterCounters).values({
      paywallId: paywall.id,
      contactId,
      anonId: contactId ? null : anonId,
      windowStartsAt: at,
      count: 1,
    });
    return 1;
  }
  const expired = at.getTime() - existing.windowStartsAt.getTime() >= windowMs;
  if (expired) {
    await tx
      .update(meterCounters)
      .set({ windowStartsAt: at, count: 1 })
      .where(eq(meterCounters.id, existing.id));
    return 1;
  }
  const count = existing.count + 1;
  await tx.update(meterCounters).set({ count }).where(eq(meterCounters.id, existing.id));
  return count;
}

export async function decidePaywall(
  tx: Tx,
  input: {
    actor: Actor;
    paywallId?: string;
    kind: ContentKind;
    selector: string;
    anonId?: string | null;
    at?: Date;
  },
): Promise<PaywallDecision> {
  const at = input.at ?? new Date();
  let wall: PaywallRow | undefined;
  if (input.paywallId) {
    const [found] = await tx
      .select()
      .from(paywalls)
      .where(and(eq(paywalls.id, input.paywallId), eq(paywalls.status, "active")))
      .limit(1);
    wall = found;
  } else {
    const candidates = await tx
      .select()
      .from(paywalls)
      .where(eq(paywalls.status, "active"));
    const matches = candidates.filter((row) =>
      appliesTo(row.appliesTo, input.kind, input.selector),
    );
    matches.sort((left, right) => {
      const leftExact = left.appliesTo.selector === "*" ? 1 : 0;
      const rightExact = right.appliesTo.selector === "*" ? 1 : 0;
      if (leftExact !== rightExact) return leftExact - rightExact;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
    wall = matches[0];
  }
  if (!wall) return OPEN;

  const denied = (reveal: "preview" | "none"): PaywallDecision => ({
    gated: true,
    allowed: false,
    reveal,
    previewStrategy: wall.previewStrategy,
    previewValue: wall.previewValue,
    seoPolicy: wall.seoPolicy,
    paywallId: wall.id,
    upsellPageId: wall.upsellPageId,
  });
  const granted: PaywallDecision = {
    gated: true,
    allowed: true,
    reveal: "all",
    previewStrategy: wall.previewStrategy,
    previewValue: wall.previewValue,
    seoPolicy: wall.seoPolicy,
    paywallId: wall.id,
    upsellPageId: wall.upsellPageId,
  };

  const contactId = await actorContactId(tx, input.actor);
  let allowed = false;
  if (wall.mode === "registration") {
    allowed = contactId !== null;
  } else if (contactId && wall.requiredEntitlementIds.length > 0) {
    allowed = await holdsRequired(tx, contactId, wall.requiredEntitlementIds, at);
  } else if (contactId) {
    const resource = {
      kind: wall.appliesTo.kind,
      ...(wall.appliesTo.selector !== "*" ? { selector: wall.appliesTo.selector } : {}),
    };
    allowed = await contactHasAccess(tx, contactId, resource, at);
  }

  if (allowed) return granted;

  if (wall.mode === "metered") {
    const subject = contactId ?? input.anonId ?? null;
    if (!subject) return denied("none");
    const count = await bumpMeter(tx, wall, contactId, contactId ? null : input.anonId!, at);
    if (count <= wall.meterCount) return granted;
    return denied("none");
  }

  if (wall.mode === "soft") {
    return denied(wall.previewValue > 0 ? "preview" : "none");
  }

  return denied("none");
}
