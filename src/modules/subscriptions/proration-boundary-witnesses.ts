// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33: timing evidence belongs to exact original canonical targets.
import { inArray, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { subscriptionProrationCashConfirmations, subscriptionProrationCreditConfirmations } from "./proration-boundary-schema";
export async function subscriptionProrationBoundaryWitnesses(tx: Tx, invoiceIds: readonly string[]) {
  const empty = { cash: [], credit: [], incomplete: false };
  if (!invoiceIds.length) return empty;
  if (invoiceIds.length > 5000) return { ...empty, incomplete: true };
  const hash = (row: unknown) => sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
  const cash = await tx.select({ id: subscriptionProrationCashConfirmations.paymentId, invoiceId: subscriptionProrationCashConfirmations.invoiceId,
    prorationId: subscriptionProrationCashConfirmations.prorationId, fingerprint: hash(subscriptionProrationCashConfirmations) })
    .from(subscriptionProrationCashConfirmations).where(inArray(subscriptionProrationCashConfirmations.invoiceId, [...invoiceIds])).orderBy(subscriptionProrationCashConfirmations.paymentId).limit(5001);
  const credit = await tx.select({ id: subscriptionProrationCreditConfirmations.applicationId, invoiceId: subscriptionProrationCreditConfirmations.invoiceId,
    prorationId: subscriptionProrationCreditConfirmations.prorationId, fingerprint: hash(subscriptionProrationCreditConfirmations) })
    .from(subscriptionProrationCreditConfirmations).where(inArray(subscriptionProrationCreditConfirmations.invoiceId, [...invoiceIds])).orderBy(subscriptionProrationCreditConfirmations.applicationId).limit(5001);
  return { cash, credit, incomplete: cash.length + credit.length > 5000 };
}
