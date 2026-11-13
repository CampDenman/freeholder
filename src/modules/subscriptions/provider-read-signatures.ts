// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: an original process can sign its own admission/finish, never a successor's.
import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
export const providerReadSignedProof = z.object({ version: z.literal(1), kind: z.enum(["admission", "finish", "stop_review"]),
  payload: z.record(z.string(), z.unknown()), publicKey: z.string().min(40).max(2000), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
export type ProviderReadSignedProof = z.infer<typeof providerReadSignedProof>;
export function providerReaderStopVerdict(input: { expectedAdmissionDigest: string; actualAdmissionDigest: string; expectedSourceRevision: string; actualSourceRevision: string;
  expectedCallerId: string; actualCallerId: unknown; finished: boolean; liveness: "live" | "absent" | "unobservable"; runtimeEvidence: boolean }) {
  if (input.expectedAdmissionDigest !== input.actualAdmissionDigest || input.expectedSourceRevision !== input.actualSourceRevision || input.expectedCallerId !== input.actualCallerId || input.finished) return "changed_or_finished" as const;
  if (input.liveness === "live") return "live" as const;
  if (input.liveness === "unobservable" && !input.runtimeEvidence) return "missing_runtime_evidence" as const;
  return input.liveness === "absent" ? "original_process_absent" as const : "unobservable_host_review" as const;
}
const slot = Symbol.for("freeholder.subscription-provider-read-signing.v1");
const runtime = globalThis as typeof globalThis & { [slot]?: { privateKey: KeyObject; publicKey: string } };
function message(kind: ProviderReadSignedProof["kind"], payload: Record<string, unknown>) {
  return Buffer.from(`freeholder:subscription-provider-read:v1\0${kind}\0${merchantTaxDigest(payload)}`);
}
/** The key is deliberately process-local. A restart cannot sign a lost caller's
 * finish. Public verification survives in immutable database-owned receipts. */
export function signProviderReadProof(kind: ProviderReadSignedProof["kind"], payload: Record<string, unknown>): ProviderReadSignedProof {
  if (!runtime[slot]) { const pair = generateKeyPairSync("ed25519"); runtime[slot] = { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }; }
  const key = runtime[slot];
  return { version: 1, kind, payload, publicKey: key.publicKey, signature: sign(null, message(kind, payload), key.privateKey).toString("base64url") };
}
export function verifiedProviderReadProof(value: unknown, kind: ProviderReadSignedProof["kind"]): ProviderReadSignedProof | null {
  const proof = providerReadSignedProof.safeParse(value);
  if (!proof.success || proof.data.kind !== kind || Buffer.byteLength(JSON.stringify(proof.data.payload)) > 256000) return null;
  try { const key = createPublicKey(proof.data.publicKey); return key.asymmetricKeyType === "ed25519" && verify(null, message(kind, proof.data.payload), key, Buffer.from(proof.data.signature, "base64url")) ? proof.data : null; } catch { return null; }
}
export function originalProviderReadAdmission(entry: Record<string, unknown>) {
  if (!["schedule_read_admitted", "phase_product_read_admitted"].includes(String(entry.source))) return false;
  if (entry.ownership === undefined) return true; // Historical callerId-only provenance stays historical.
  const proof = verifiedProviderReadProof(entry.ownership, "admission");
  const original = { ...entry }; delete original.ownership;
  const caller = proof?.payload.caller;
  return !!proof && proof.payload.admissionDigest === merchantTaxDigest(original) && proof.payload.readId === entry.readId
    && proof.payload.operationId === entry.operationId && proof.payload.requestDigest === entry.requestDigest
    && proof.payload.callerId === entry.callerId && proof.payload.completionDigest === entry.completionDigest
    && !!caller && typeof caller === "object" && !Array.isArray(caller) && (caller as Record<string, unknown>).id === entry.callerId
    && Number.isSafeInteger((caller as Record<string, unknown>).pid) && Number((caller as Record<string, unknown>).pid) > 0;
}
/** Only a distinct immutable human stop receipt releases an original reader.
 * A stop review is never accepted as a returned/thrown provider finish. */
export function stoppedProviderRead(admission: Record<string, unknown>, entry: Record<string, unknown>, subscriptionId: string): boolean {
  if (entry.source !== "provider_read_stop_reviewed" || entry.readId !== admission.readId || entry.operationId !== admission.operationId
    || entry.requestDigest !== admission.requestDigest || !originalProviderReadAdmission(admission)) return false;
  const proof = verifiedProviderReadProof(entry.proof, "stop_review"), payload = proof?.payload;
  return !!payload && payload.readId === admission.readId && payload.operationId === admission.operationId && payload.subscriptionId === subscriptionId
    && payload.requestDigest === admission.requestDigest && payload.callerId === admission.callerId && payload.admissionDigest === merchantTaxDigest(admission)
    && !!payload.originalAdmission && typeof payload.originalAdmission === "object" && merchantTaxDigest(payload.originalAdmission) === merchantTaxDigest(admission)
    && typeof payload.reviewedBy === "string" && /^user:[a-f0-9-]{36}$/.test(payload.reviewedBy)
    && ["original_process_absent", "unobservable_host_review"].includes(String(payload.mechanicalCheck))
    && typeof payload.hostingEvidenceDigest === "string" && /^[a-f0-9]{64}$/.test(payload.hostingEvidenceDigest)
    && typeof payload.sourceRevision === "string" && /^[a-f0-9]{64}$/.test(payload.sourceRevision)
    && entry.receiptDigest === merchantTaxDigest(proof);
}
