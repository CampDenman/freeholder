// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Compute access from grants (MASTER.md §4.15, C9.14).
//
// The only question this file answers is "may this person use this resource
// right now". A page does not carry "members only"; a grant does. Helpers
// take a transaction so a subscribe, a pause and a tier change can move the
// grant in the same mutation that moved the money — a listener that ran after
// commit would leave a window where somebody had paid and could not get in.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import {
  GRANTOR_TYPES,
  contentUnlocks,
  entitlementGrants,
  entitlements,
  passBalances,
  type Resource,
} from "./schema";

export type { Resource };

export function resourceMatches(granted: Resource, asked: Resource): boolean {
  // A site-wide membership is the thing a $5/month plan grants by default:
  // one purchase, every gated surface, no three flags.
  if (granted.kind === "site") return true;
  if (granted.kind !== asked.kind) return false;
  if (!granted.selector || granted.selector === "*") return true;
  return granted.selector === asked.selector;
}

function nowOr(value?: Date): Date {
  return value ?? new Date();
}

export async function contactHasAccess(
  tx: Tx,
  contactId: string | null,
  asked: Resource,
  at?: Date,
): Promise<boolean> {
  if (!contactId) return false;
  const when = nowOr(at);
  const rows = await tx
    .select({
      resource: entitlements.resource,
      quantity: entitlements.quantity,
      used: entitlementGrants.used,
      startsAt: entitlementGrants.startsAt,
      endsAt: entitlementGrants.endsAt,
      status: entitlementGrants.status,
    })
    .from(entitlementGrants)
    .innerJoin(entitlements, eq(entitlements.id, entitlementGrants.entitlementId))
    .where(
      and(
        eq(entitlementGrants.contactId, contactId),
        eq(entitlementGrants.status, "active"),
        eq(entitlements.status, "active"),
      ),
    );
  return rows.some((row) => {
    if (row.startsAt > when) return false;
    if (row.endsAt && row.endsAt <= when) return false;
    if (row.quantity !== null && row.used >= row.quantity) return false;
    return resourceMatches(row.resource, asked);
  });
}

export async function ensureEntitlement(
  tx: Tx,
  input: {
    grantorType: (typeof GRANTOR_TYPES)[number];
    grantorId: string;
    name: string;
    resource: Resource;
    quantity?: number | null;
    period?: "per_month" | "per_cycle" | "total";
    priority?: number;
  },
): Promise<{ id: string }> {
  const resource: Resource = input.resource.selector
    ? { kind: input.resource.kind, selector: input.resource.selector }
    : { kind: input.resource.kind };
  const [existing] = await tx
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.grantorType, input.grantorType),
        eq(entitlements.grantorId, input.grantorId),
        sql`${entitlements.resource} = ${JSON.stringify(resource)}::jsonb`,
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(entitlements)
    .values({
      grantorType: input.grantorType,
      grantorId: input.grantorId,
      name: input.name,
      resource,
      quantity: input.quantity ?? null,
      period: input.period ?? "total",
      priority: input.priority ?? 0,
      status: "active",
    })
    .returning({ id: entitlements.id });
  return created!;
}

export async function ensureGrant(
  tx: Tx,
  input: {
    contactId: string;
    entitlementId: string;
    startsAt: Date;
    endsAt?: Date | null;
    status?: "active" | "paused";
    sourceSubscriptionId?: string | null;
    sourcePassBalanceId?: string | null;
    sourceUnlockId?: string | null;
  },
): Promise<{ id: string }> {
  const status = input.status ?? "active";
  const source =
    input.sourceSubscriptionId
      ? and(
          eq(entitlementGrants.entitlementId, input.entitlementId),
          eq(entitlementGrants.contactId, input.contactId),
          eq(entitlementGrants.sourceSubscriptionId, input.sourceSubscriptionId),
          inArray(entitlementGrants.status, ["active", "paused"]),
        )
      : input.sourcePassBalanceId
        ? and(
            eq(entitlementGrants.entitlementId, input.entitlementId),
            eq(entitlementGrants.contactId, input.contactId),
            eq(entitlementGrants.sourcePassBalanceId, input.sourcePassBalanceId),
            inArray(entitlementGrants.status, ["active", "paused"]),
          )
        : input.sourceUnlockId
          ? and(
              eq(entitlementGrants.entitlementId, input.entitlementId),
              eq(entitlementGrants.contactId, input.contactId),
              eq(entitlementGrants.sourceUnlockId, input.sourceUnlockId),
              inArray(entitlementGrants.status, ["active", "paused"]),
            )
          : and(
              eq(entitlementGrants.entitlementId, input.entitlementId),
              eq(entitlementGrants.contactId, input.contactId),
              sql`${entitlementGrants.sourceSubscriptionId} is null`,
              sql`${entitlementGrants.sourcePassBalanceId} is null`,
              sql`${entitlementGrants.sourceUnlockId} is null`,
              inArray(entitlementGrants.status, ["active", "paused"]),
            );

  const [existing] = await tx
    .select({ id: entitlementGrants.id })
    .from(entitlementGrants)
    .where(source)
    .limit(1);
  if (existing) {
    await tx
      .update(entitlementGrants)
      .set({
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        status,
      })
      .where(eq(entitlementGrants.id, existing.id));
    return existing;
  }
  const [created] = await tx
    .insert(entitlementGrants)
    .values({
      contactId: input.contactId,
      entitlementId: input.entitlementId,
      sourceSubscriptionId: input.sourceSubscriptionId ?? null,
      sourcePassBalanceId: input.sourcePassBalanceId ?? null,
      sourceUnlockId: input.sourceUnlockId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      status,
    })
    .returning({ id: entitlementGrants.id });
  return created!;
}

export async function setSubscriptionGrantStatus(
  tx: Tx,
  subscriptionId: string,
  status: "active" | "paused" | "expired" | "revoked",
  endsAt?: Date | null,
): Promise<number> {
  const patch: {
    status: typeof status;
    endsAt?: Date | null;
  } = { status };
  if (endsAt !== undefined) patch.endsAt = endsAt;
  const rows = await tx
    .update(entitlementGrants)
    .set(patch)
    .where(
      and(
        eq(entitlementGrants.sourceSubscriptionId, subscriptionId),
        inArray(entitlementGrants.status, ["active", "paused"]),
      ),
    )
    .returning({ id: entitlementGrants.id });
  return rows.length;
}

export async function syncSubscriptionAccess(
  tx: Tx,
  input: {
    subscriptionId: string;
    contactId: string;
    planId: string;
    planName: string;
    startsAt: Date;
    endsAt: Date;
    status: "active" | "paused" | "expired" | "revoked";
  },
): Promise<void> {
  const defined = await tx
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.grantorType, "plan"),
        eq(entitlements.grantorId, input.planId),
        eq(entitlements.status, "active"),
      ),
    );
  const catalogue =
    defined.length > 0
      ? defined
      : [
          await (async () => {
            const created = await ensureEntitlement(tx, {
              grantorType: "plan",
              grantorId: input.planId,
              name: input.planName,
              resource: { kind: "site" },
            });
            const [row] = await tx
              .select()
              .from(entitlements)
              .where(eq(entitlements.id, created.id));
            return row!;
          })(),
        ];

  if (input.status === "expired" || input.status === "revoked") {
    await setSubscriptionGrantStatus(tx, input.subscriptionId, input.status, input.endsAt);
    return;
  }

  for (const entitlement of catalogue) {
    await ensureGrant(tx, {
      contactId: input.contactId,
      entitlementId: entitlement.id,
      sourceSubscriptionId: input.subscriptionId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: input.status,
    });
  }
}

export async function syncTierAccess(
  tx: Tx,
  input: {
    contactId: string;
    fromTierId: string | null;
    toTierId: string | null;
    endsAt?: Date | null;
  },
): Promise<void> {
  if (input.fromTierId && input.fromTierId !== input.toTierId) {
    const previous = await tx
      .select({ id: entitlements.id })
      .from(entitlements)
      .where(
        and(eq(entitlements.grantorType, "tier"), eq(entitlements.grantorId, input.fromTierId)),
      );
    if (previous.length) {
      await tx
        .update(entitlementGrants)
        .set({ status: "revoked", endsAt: new Date() })
        .where(
          and(
            eq(entitlementGrants.contactId, input.contactId),
            inArray(
              entitlementGrants.entitlementId,
              previous.map((row) => row.id),
            ),
            inArray(entitlementGrants.status, ["active", "paused"]),
          ),
        );
    }
  }
  if (!input.toTierId) return;
  const next = await tx
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.grantorType, "tier"),
        eq(entitlements.grantorId, input.toTierId),
        eq(entitlements.status, "active"),
      ),
    );
  const startsAt = new Date();
  for (const entitlement of next) {
    await ensureGrant(tx, {
      contactId: input.contactId,
      entitlementId: entitlement.id,
      startsAt,
      endsAt: input.endsAt ?? null,
      status: "active",
    });
  }
}

export async function issuePassBalance(
  tx: Tx,
  input: {
    contactId: string;
    productId: string;
    productName: string;
    quantity: number;
    sourceOrderId?: string | null;
    expiresAt?: Date | null;
  },
): Promise<{ passBalanceId: string; grantId: string }> {
  const entitlement = await ensureEntitlement(tx, {
    grantorType: "pass",
    grantorId: input.productId,
    name: input.productName,
    resource: { kind: "pass", selector: input.productId },
    quantity: input.quantity,
    period: "total",
  });
  if (input.sourceOrderId) {
    const [existing] = await tx
      .select({ id: passBalances.id })
      .from(passBalances)
      .where(
        and(
          eq(passBalances.sourceOrderId, input.sourceOrderId),
          eq(passBalances.productId, input.productId),
        ),
      )
      .limit(1);
    if (existing) {
      const [grant] = await tx
        .select({ id: entitlementGrants.id })
        .from(entitlementGrants)
        .where(eq(entitlementGrants.sourcePassBalanceId, existing.id))
        .limit(1);
      return { passBalanceId: existing.id, grantId: grant?.id ?? existing.id };
    }
  }
  const [balance] = await tx
    .insert(passBalances)
    .values({
      contactId: input.contactId,
      productId: input.productId,
      entitlementId: entitlement.id,
      quantityOriginal: input.quantity,
      quantityRemaining: input.quantity,
      sourceOrderId: input.sourceOrderId ?? null,
      expiresAt: input.expiresAt ?? null,
      status: "active",
    })
    .returning({ id: passBalances.id });
  const grant = await ensureGrant(tx, {
    contactId: input.contactId,
    entitlementId: entitlement.id,
    sourcePassBalanceId: balance!.id,
    startsAt: new Date(),
    endsAt: input.expiresAt ?? null,
    status: "active",
  });
  return { passBalanceId: balance!.id, grantId: grant.id };
}

export async function issueUnlockRecord(
  tx: Tx,
  input: {
    contactId: string;
    invoiceId: string;
    resource: Resource;
    name: string;
  },
): Promise<{ unlockId: string; grantId: string }> {
  const [existing] = await tx
    .select({ id: contentUnlocks.id, entitlementId: contentUnlocks.entitlementId })
    .from(contentUnlocks)
    .where(eq(contentUnlocks.invoiceId, input.invoiceId))
    .limit(1);
  if (existing) {
    const [grant] = await tx
      .select({ id: entitlementGrants.id })
      .from(entitlementGrants)
      .where(eq(entitlementGrants.sourceUnlockId, existing.id))
      .limit(1);
    return { unlockId: existing.id, grantId: grant?.id ?? existing.id };
  }
  const entitlement = await ensureEntitlement(tx, {
    grantorType: "unlock",
    grantorId: input.invoiceId,
    name: input.name,
    resource: input.resource,
    period: "total",
  });
  const [unlock] = await tx
    .insert(contentUnlocks)
    .values({
      contactId: input.contactId,
      invoiceId: input.invoiceId,
      entitlementId: entitlement.id,
    })
    .returning({ id: contentUnlocks.id });
  const grant = await ensureGrant(tx, {
    contactId: input.contactId,
    entitlementId: entitlement.id,
    sourceUnlockId: unlock!.id,
    startsAt: new Date(),
    endsAt: null,
    status: "active",
  });
  return { unlockId: unlock!.id, grantId: grant.id };
}

export async function spendPassPunch(
  tx: Tx,
  input: { passBalanceId: string; contactId: string },
): Promise<{ remaining: number }> {
  const [balance] = await tx
    .select()
    .from(passBalances)
    .where(
      and(
        eq(passBalances.id, input.passBalanceId),
        eq(passBalances.contactId, input.contactId),
      ),
    );
  if (!balance) throw new Error("not_found");
  if (balance.status !== "active" || balance.quantityRemaining <= 0) {
    throw new Error("exhausted");
  }
  const remaining = balance.quantityRemaining - 1;
  await tx
    .update(passBalances)
    .set({
      quantityRemaining: remaining,
      status: remaining === 0 ? "exhausted" : "active",
    })
    .where(eq(passBalances.id, balance.id));
  const [grant] = await tx
    .select({ id: entitlementGrants.id, used: entitlementGrants.used })
    .from(entitlementGrants)
    .where(eq(entitlementGrants.sourcePassBalanceId, balance.id))
    .limit(1);
  if (grant) {
    await tx
      .update(entitlementGrants)
      .set({
        used: grant.used + 1,
        status: remaining === 0 ? "expired" : "active",
      })
      .where(eq(entitlementGrants.id, grant.id));
  }
  return { remaining };
}
