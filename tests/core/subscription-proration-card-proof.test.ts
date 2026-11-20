// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: cryptographic authority and an actual stopped OS birth, not age/heartbeat heuristics.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantCallerLiveness, merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { PRORATION_CARD_READ_PURPOSE } from "@/modules/subscriptions/proration-card-contract";
import { originalProrationCardRead, finishedProrationCardRead, stoppedProrationCardRead } from "@/modules/subscriptions/proration-card-read-proof";
import { providerReaderStopVerdict, signProviderReadProof } from "@/modules/subscriptions/provider-read-signatures";
import type { subscriptionProrationCardReads, subscriptionProrationCardReadFinishes, subscriptionProrationCardReadStops } from "@/modules/subscriptions/proration-card-schema";
function original() {
  const id = randomUUID(), paymentId = randomUUID(), prorationId = randomUUID(), caller = merchantPhysicalCaller();
  const admission = signProviderReadProof("admission", { purpose: PRORATION_CARD_READ_PURPOSE, readId: id, paymentId, prorationId,
    caller, callerId: caller.id, requestDigest: "a".repeat(64), sourceRevision: "b".repeat(64), completionDigest: "c".repeat(64) });
  return { id, paymentId, admission, admissionDigest: merchantTaxDigest(admission), createdAt: new Date() } satisfies typeof subscriptionProrationCardReads.$inferSelect;
}
function finish(ticket: ReturnType<typeof original>, patch: Record<string, unknown> = {}) {
  const p = ticket.admission.payload, actualResult = { outcome: "returned", actualBankResultDigest: "d".repeat(64) };
  const proof = signProviderReadProof("finish", { purpose: PRORATION_CARD_READ_PURPOSE, readId: ticket.id, paymentId: ticket.paymentId, prorationId: p.prorationId,
    callerId: p.callerId, requestDigest: p.requestDigest, completionDigest: p.completionDigest, admissionDigest: ticket.admissionDigest, outcome: actualResult.outcome, factsDigest: merchantTaxDigest(actualResult), ...patch });
  return { readId: ticket.id, proof, proofDigest: merchantTaxDigest(proof), actualResult, createdAt: new Date() } satisfies typeof subscriptionProrationCardReadFinishes.$inferSelect;
}
function stopped(ticket: ReturnType<typeof original>, patch: Record<string, unknown> = {}) {
  const p = ticket.admission.payload;
  const proof = signProviderReadProof("stop_review", { purpose: PRORATION_CARD_READ_PURPOSE, readId: ticket.id, paymentId: ticket.paymentId, prorationId: p.prorationId,
    requestDigest: p.requestDigest, callerId: p.callerId, admissionDigest: ticket.admissionDigest, originalAdmission: ticket.admission,
    reviewedBy: `user:${randomUUID()}`, mechanicalCheck: "original_process_absent", sourceRevision: p.sourceRevision, hostingEvidenceDigest: "f".repeat(64), ...patch });
  return { readId: ticket.id, proof, proofDigest: merchantTaxDigest(proof), createdAt: new Date() } satisfies typeof subscriptionProrationCardReadStops.$inferSelect;
}
describe("original changed-price bank reader proof", () => {
  it("binds an actual signature to original read, payment, caller birth and nonce", () => {
    const ticket = original(); expect(originalProrationCardRead(ticket)).not.toBeNull();
    expect(originalProrationCardRead({ ...ticket, paymentId: randomUUID() })).toBeNull();
    expect(originalProrationCardRead({ ...ticket, admission: { ...ticket.admission, payload: { ...ticket.admission.payload, completionDigest: "d".repeat(64) } } })).toBeNull();
  });
  it("requires the original signed actual result, refusing substitution of request, nonce or actual facts", () => {
    const ticket = original(), actual = finish(ticket); expect(finishedProrationCardRead(ticket, actual)).toBe(true);
    expect(finishedProrationCardRead(ticket, { ...actual, actualResult: { ...actual.actualResult, actualBankResultDigest: "0".repeat(64) } })).toBe(false);
    for (const patch of [{ requestDigest: "f".repeat(64) }, { completionDigest: "0".repeat(64) }, { paymentId: randomUUID() }, { callerId: randomUUID() }])
      expect(finishedProrationCardRead(ticket, finish(ticket, patch))).toBe(false);
  });
  it("never counts an independently signed stop as an actual returned or thrown finish", () => {
    const ticket = original(), stop = stopped(ticket);
    expect(stoppedProrationCardRead(ticket, stop)).toBe(true);
    expect(finishedProrationCardRead(ticket, { ...stop, actualResult: { outcome: "returned" } })).toBe(false);
  });
  it("refuses another caller's genuine signed stop and a tampered exact-admission proof", () => {
    const ticket = original();
    for (const patch of [{ originalAdmission: {} }, { callerId: randomUUID() }, { reviewedBy: "agent:fictional-review" }, { readId: randomUUID() }])
      expect(stoppedProrationCardRead(ticket, stopped(ticket, patch))).toBe(false);
    const receipt = stopped(ticket); expect(stoppedProrationCardRead(ticket, { ...receipt, proofDigest: "0".repeat(64) })).toBe(false);
  });
  it("does not let a later genuinely finished reader close the original outstanding read", () => {
    const first = original(), later = original();
    expect(finishedProrationCardRead(later, finish(later))).toBe(true);
    expect(finishedProrationCardRead(first, finish(later))).toBe(false);
    expect(stoppedProrationCardRead(first, stopped(later))).toBe(false);
  });
  it.runIf(process.platform === "linux")("requires actual absence of the exact original process birth, not elapsed time or a new reader", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    await once(child, "spawn");
    const caller = { ...merchantPhysicalCaller(), id: randomUUID(), pid: child.pid!, startTicks: readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ").at(-1)!.trim().split(/\s+/)[19]! };
    const authority = { expectedAdmissionDigest: "a", actualAdmissionDigest: "a", expectedSourceRevision: "b", actualSourceRevision: "b", expectedCallerId: caller.id,
      actualCallerId: caller.id, finished: false, liveness: merchantCallerLiveness(caller), runtimeEvidence: true };
    try {
      expect(authority.liveness).toBe("live"); expect(providerReaderStopVerdict(authority)).toBe("live");
      const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
      expect(merchantCallerLiveness(caller)).toBe("absent");
      expect(providerReaderStopVerdict({ ...authority, liveness: merchantCallerLiveness(caller) })).toBe("original_process_absent");
      expect(providerReaderStopVerdict({ ...authority, liveness: "unobservable", runtimeEvidence: false })).toBe("missing_runtime_evidence");
    } finally { child.kill("SIGKILL"); }
  });
});
