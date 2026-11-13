// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: an independent GET never borrows its POST's completion receipt.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { verifiedProviderReadProof } from "./provider-read-signatures";
import { PRORATION_CARD_READ_PURPOSE } from "./proration-card-contract";
import { subscriptionProrationCardReads, subscriptionProrationCardReadFinishes, subscriptionProrationCardReadStops } from "./proration-card-schema";
const sha = /^[a-f0-9]{64}$/;
export const prorationCardCaller = z.object({ id: z.uuid(), pid: z.number().int().positive(), host: z.string().min(1).max(500), startedAt: z.iso.datetime(),
  bootId: z.string().nullable(), pidNamespace: z.string().nullable(), startTicks: z.string().nullable() }).strict();
type Ticket = typeof subscriptionProrationCardReads.$inferSelect;
export function originalProrationCardRead(ticket: Ticket) {
  const proof = verifiedProviderReadProof(ticket.admission, "admission"), payload = proof?.payload, caller = prorationCardCaller.safeParse(payload?.caller);
  return proof && payload?.purpose === PRORATION_CARD_READ_PURPOSE && payload.readId === ticket.id && payload.paymentId === ticket.paymentId
    && z.uuid().safeParse(payload.prorationId).success && typeof payload.requestDigest === "string" && sha.test(payload.requestDigest)
    && typeof payload.sourceRevision === "string" && sha.test(payload.sourceRevision) && typeof payload.completionDigest === "string" && sha.test(payload.completionDigest)
    && caller.success && caller.data.id === payload.callerId && ticket.admissionDigest === merchantTaxDigest(ticket.admission) ? proof : null;
}
export function finishedProrationCardRead(ticket: Ticket, finish: typeof subscriptionProrationCardReadFinishes.$inferSelect | null) {
  if (!finish) return false;
  const original = originalProrationCardRead(ticket), proof = verifiedProviderReadProof(finish.proof, "finish"), payload = proof?.payload;
  return !!original && !!proof && finish.readId === ticket.id && proof.publicKey === original.publicKey && payload?.purpose === PRORATION_CARD_READ_PURPOSE
    && payload.readId === ticket.id && payload.paymentId === ticket.paymentId && payload.prorationId === original.payload.prorationId
    && payload.admissionDigest === ticket.admissionDigest && payload.requestDigest === original.payload.requestDigest && payload.callerId === original.payload.callerId
    && payload.completionDigest === original.payload.completionDigest && ["returned", "threw"].includes(String(payload.outcome))
    && payload.outcome === finish.actualResult.outcome && payload.factsDigest === merchantTaxDigest(finish.actualResult) && finish.proofDigest === merchantTaxDigest(finish.proof);
}
export function stoppedProrationCardRead(ticket: Ticket, stop: typeof subscriptionProrationCardReadStops.$inferSelect | null) {
  if (!stop) return false;
  const original = originalProrationCardRead(ticket), proof = verifiedProviderReadProof(stop.proof, "stop_review"), payload = proof?.payload;
  return !!original && !!proof && stop.readId === ticket.id && payload?.purpose === PRORATION_CARD_READ_PURPOSE && payload.readId === ticket.id
    && payload.paymentId === ticket.paymentId && payload.prorationId === original.payload.prorationId && payload.admissionDigest === ticket.admissionDigest
    && payload.requestDigest === original.payload.requestDigest && payload.callerId === original.payload.callerId && merchantTaxDigest(payload.originalAdmission) === merchantTaxDigest(ticket.admission)
    && typeof payload.reviewedBy === "string" && /^user:[a-f0-9-]{36}$/.test(payload.reviewedBy)
    && ["original_process_absent", "unobservable_host_review"].includes(String(payload.mechanicalCheck))
    && payload.sourceRevision === original.payload.sourceRevision && typeof payload.hostingEvidenceDigest === "string" && sha.test(payload.hostingEvidenceDigest)
    && stop.proofDigest === merchantTaxDigest(stop.proof);
}
export async function originalProrationCardReadRows(tx: Tx, paymentIds: readonly string[]) {
  if (paymentIds.length > 5000) throw new ServiceError("conflict", "Restore the bounded complete original card-reader inventory.");
  const rows = paymentIds.length ? await tx.select({ read: subscriptionProrationCardReads, finish: subscriptionProrationCardReadFinishes, stop: subscriptionProrationCardReadStops }).from(subscriptionProrationCardReads)
    .leftJoin(subscriptionProrationCardReadFinishes, eq(subscriptionProrationCardReadFinishes.readId, subscriptionProrationCardReads.id))
    .leftJoin(subscriptionProrationCardReadStops, eq(subscriptionProrationCardReadStops.readId, subscriptionProrationCardReads.id))
    .where(inArray(subscriptionProrationCardReads.paymentId, [...paymentIds])).orderBy(subscriptionProrationCardReads.id).limit(5001) : [];
  if (rows.length + rows.filter(row => row.finish).length + rows.filter(row => row.stop).length > 5000)
    throw new ServiceError("conflict", "A truncated original card-read inventory remains debt; later successful reads cannot replace it.");
  if (rows.some(row => !originalProrationCardRead(row.read) || row.finish && !finishedProrationCardRead(row.read, row.finish) || row.stop && !stoppedProrationCardRead(row.read, row.stop) || row.finish && row.stop))
    throw new ServiceError("conflict", "Restore the authentic original card admission/actual finish or distinct stop; never re-sign old history.");
  return rows;
}
export async function assertProrationCardReadsQuiesced(tx: Tx, paymentIds: readonly string[]) {
  const rows = await originalProrationCardReadRows(tx, paymentIds);
  if (rows.some(row => !finishedProrationCardRead(row.read, row.finish) && !stoppedProrationCardRead(row.read, row.stop)))
    throw new ServiceError("conflict", "The actual original card-verification reader remains unfinished. Finish it or review its genuine runtime stop before another financial or access decision.");
}
