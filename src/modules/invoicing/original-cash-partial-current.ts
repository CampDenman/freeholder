// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: readers compose original facts without importing service registries.
import { ServiceError, type ServiceContext } from "@/core/service";
import { originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { originalCashRecoveryRevision } from "./original-cash-recovery-current";
import { originalPartialCashSource } from "./original-cash-partial-source";
import { originalPartialTarget } from "./original-cash-partial-contract";
export async function originalCashPartialReturnCurrent(ctx: ServiceContext, paymentId: string) {
  const witness = await originalCashRecoveryFinancialWitness(ctx.tx, [paymentId], []);
  for (const owner of witness.owners) {
    if (!owner.owner.cash.applied) continue;
    const closures = witness.facts.filter(fact => fact.recoveryId === owner.id && fact.kind === "partial_closure").sort((a,b) => b.sequence-a.sequence);
    if (!closures.length) continue;
    const current = await originalCashRecoveryRevision(ctx, owner.id);
    let source:Awaited<ReturnType<typeof originalPartialCashSource>>;
    try { source = await originalPartialCashSource(ctx, paymentId, false); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") return null; throw error; }
    for (const closure of closures) {
      const actual = witness.facts.find(fact => fact.id === closure.evidence.targetFactId && fact.kind === "partial_target" && fact.recoveryId === owner.id);
      if (!actual || closure.evidence.revision !== current.revision || closure.evidence.sourceDigest !== source.sourceDigest) continue;
      const target = originalPartialTarget.parse(actual.evidence);
      if (target.paymentId !== paymentId || target.customerReturnedMinor !== source.customerReturnedMinor || target.sourceDigest !== source.sourceDigest
        || target.acceptedFeeMinor !== source.acceptedFeeMinor || target.acceptedFeeRetainedMinor !== source.acceptedFeeRetainedMinor) continue;
      return { targetFactId: actual.id, customerReturnedMinor: target.customerReturnedMinor, acceptedFeeRetainedMinor: target.acceptedFeeRetainedMinor,
        feeTargetMinor: target.feeTargetMinor, recipientTargetMinor: target.recipientTargetMinor };
    }
  }
  return null;
}
