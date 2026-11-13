// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: financial readers do not import a service-registration module.
import { ServiceError, type ServiceContext } from "@/core/service";
import { originalMerchantRefundCash, lockMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalCashRecoveryFinancialWitness, originalCashRecoveryOwner } from "./original-cash-recovery-store";
export async function boundOriginalCashRecovery(ctx: ServiceContext, recoveryId: string) {
  const owner = await originalCashRecoveryOwner(ctx.tx, recoveryId), cash = await originalMerchantRefundCash(ctx, owner.owner.source);
  await lockMerchantRefundCash(ctx, cash);
  const actual = await originalMerchantRefundCash(ctx, owner.owner.source);
  if (merchantTaxDigest({ ...actual, applied: owner.owner.cash.applied }) !== merchantTaxDigest(owner.owner.cash)
    || actual.applied !== owner.owner.cash.applied) throw new ServiceError("conflict", "Restore this original cash namespace and canonical application before returning money; do not rebind its receipt.");
  return { owner, cash: actual };
}
export async function originalCashRecoveryRevision(ctx: ServiceContext, recoveryId: string, excludedRead?: string) {
  const { cash } = await boundOriginalCashRecovery(ctx, recoveryId), history = await merchantRefundCashHistory(ctx, cash, undefined, excludedRead);
  if (history.incomplete) throw new ServiceError("conflict", "Restore the complete original cash/caller inventory before current return proof.");
  return { cash, history, revision: merchantTaxDigest({ cash, history: history.digest }) };
}
export async function originalCashFullReturnCurrent(ctx: ServiceContext, paymentId: string): Promise<boolean> {
  const witness = await originalCashRecoveryFinancialWitness(ctx.tx, [paymentId], []);
  for (const owner of witness.owners) {
    if (!owner.owner.cash.applied) continue;
    const current = await originalCashRecoveryRevision(ctx, owner.id);
    if (witness.closures.some(closure => closure.recoveryId === owner.id && closure.revision === current.revision)) return true;
  }
  return false;
}
