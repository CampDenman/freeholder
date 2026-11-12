// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: each Paradise HTTP call has its own durable original intent.
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { MailCarrierJournal } from "@/adapters/mail/types";
import { ParadiseRequestError } from "@/adapters/paradise/http";
import { paradiseSite, type ParadiseSite } from "@/adapters/paradise/config";
import { db } from "@/core/db";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { consentRecords } from "@/core/privacy/schema";
import { ServiceError, type Tx } from "@/core/service";
import { mailDispatches, mailDispatchRequests, mailProviderGrants, type CarrierOperation } from "./schema";
import { mailReceipts } from "./receipts";
import { readOriginalMailRoute } from "./dispatch-route";

export async function admitCarrierWrites(tx: Tx) {
  const receipts = await mailReceipts(tx);
  await tx.execute(sql`select set_config('freeholder.mail_carrier_v1','1',true)`);
  return receipts;
}

export async function carrierResource(tx: Tx, site: ParadiseSite = paradiseSite()) {
  const receipts = await admitCarrierWrites(tx);
  if (!site.apiKey) throw new ServiceError("conflict", "The original carrier credentials are unavailable.");
  return { resourceDigest: receipts.digest("provider:paradise-resource", JSON.stringify([site.baseUrl, site.apiKey])), resourceBaseUrl: site.baseUrl };
}

/** One address is one provider resource even when retained consent rows differ. */
export async function lockCarrierAddress(tx: Tx, resourceDigest: string, email: string): Promise<void> {
  const receipts = await mailReceipts(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`carrier-address:${resourceDigest}:${receipts.digest("address", email)}`}))`);
}

export function carrierOperationOutcome(error: unknown): Pick<CarrierOperation, "state" | "httpStatus" | "providerCode"> {
  const refused = error instanceof ParadiseRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
  return { state: refused ? "refused" : "unknown", ...(error instanceof ParadiseRequestError ? { httpStatus: error.status, ...(error.code ? { providerCode: error.code } : {}) } : {}) };
}

/** New sends only. Legacy grants deliberately keep their missing provenance. */
export function carrierMailJournal(dispatchId: string): MailCarrierJournal {
  return { async request(operation, site, execute) {
    const id = randomUUID();
    let grantId: string | undefined;
    await db().transaction(async tx => {
      await lockContactIdentityForRead(tx);
      const resource = await carrierResource(tx, site), receipts = await mailReceipts(tx);
      const [dispatch] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId)).for("update");
      if (!dispatch || dispatch.state !== "running" || dispatch.carrierOperations.some(prior => prior.key === operation.key)) throw new ServiceError("conflict", "This original carrier operation has already been claimed or needs review.");
      const [request] = await tx.select().from(mailDispatchRequests).where(eq(mailDispatchRequests.deliveryId, dispatch.deliveryId));
      const original = request?.encryptedRoute ? readOriginalMailRoute(request.encryptedRoute, dispatch.deliveryId) : null;
      if (!original || original.provider !== "paradise" || original.carrierResourceDigest !== resource.resourceDigest) throw new ServiceError("conflict", "The original carrier resource changed before its HTTP call.");
      const evidenceRef = operation.grant?.evidenceRef ?? operation.evidenceRef;
      if (evidenceRef) {
        const consentId = evidenceRef.replace(/^freeholder-consent:/, "");
        const [retained] = await tx.select().from(consentRecords).where(eq(consentRecords.id, consentId)).for("update");
        if (!retained) throw new ServiceError("conflict", "The original marketing consent is no longer available.");
        const { canContact } = await import("@/core/privacy/service");
        const current = await canContact.call({ contactId: retained.contactId, purpose: "marketing", channel: "email" }, { kind: "system" }, { tx });
        if (!current.allowed || current.evidenceId !== retained.id) throw new ServiceError("conflict", "Marketing consent changed before this original carrier HTTP request. No further consent or campaign request was made.");
      }
      const intent: CarrierOperation = { id, kind: operation.kind, key: operation.key, resourceDigest: resource.resourceDigest, payloadDigest: receipts.digest("dispatch-payload", JSON.stringify(operation.body)), state: "running" };
      if (operation.grant) {
        await lockCarrierAddress(tx, resource.resourceDigest, operation.grant.email);
        const related = await tx.select().from(mailProviderGrants).where(and(eq(mailProviderGrants.provider, "paradise"), eq(mailProviderGrants.email, operation.grant.email.trim().toLowerCase()), eq(mailProviderGrants.resourceDigest, resource.resourceDigest), isNull(mailProviderGrants.withdrawnAt))).orderBy(mailProviderGrants.id).for("update");
        if (related.some(grant => grant.carrierOperations.some(op => op.state === "running" || op.state === "unknown"))) throw new ServiceError("conflict", "An original consent or withdrawal for this carrier address remains unresolved. Review that exact operation before recording consent again.");
        const consentId = operation.grant.evidenceRef.replace(/^freeholder-consent:/, "");
        const [consent] = await tx.select().from(consentRecords).where(and(eq(consentRecords.id, consentId), eq(consentRecords.state, "granted"))).for("update");
        if (!consent) throw new ServiceError("conflict", "The original retained marketing consent is unavailable.");
        const [prior] = await tx.select().from(mailProviderGrants).where(and(eq(mailProviderGrants.provider, "paradise"), eq(mailProviderGrants.email, operation.grant.email.trim().toLowerCase()), eq(mailProviderGrants.consentRecordId, consentId), eq(mailProviderGrants.resourceDigest, resource.resourceDigest))).for("update");
        if (prior) throw new ServiceError("conflict", "The carrier already has an original grant witness. Review it before recording consent again.");
        const [grant] = await tx.insert(mailProviderGrants).values({ provider: "paradise", email: operation.grant.email.trim().toLowerCase(), consentRecordId: consentId, ...resource, carrierOperations: [intent] }).returning({ id: mailProviderGrants.id });
        grantId = grant!.id;
      }
      await tx.update(mailDispatches).set({ carrierOperations: [...dispatch.carrierOperations, intent] }).where(eq(mailDispatches.id, dispatchId));
    });
    // The grant intent commits before provider I/O. A lost reply must not lose
    // the only address/resource that may now hold the recipient's consent.
    let result;
    try { result = await execute(); }
    catch (error) { await finish(carrierOperationOutcome(error)); throw error; }
    await finish({ state: "confirmed" }, result);
    return result;

    async function finish(outcome: Pick<CarrierOperation, "state" | "httpStatus" | "providerCode">, response?: unknown) {
      await db().transaction(async tx => {
        await carrierResource(tx, site);
        const receipts = await mailReceipts(tx);
        const patch = { ...outcome, ...(response !== undefined ? { responseDigest: receipts.digest("dispatch-resolution", JSON.stringify(response)) } : {}) };
        const [dispatch] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId)).for("update");
        if (!dispatch) throw new ServiceError("conflict", "Restore the original carrier operation witness.");
        await tx.update(mailDispatches).set({ carrierOperations: dispatch.carrierOperations.map(prior => prior.id === id ? { ...prior, ...patch } : prior) }).where(eq(mailDispatches.id, dispatchId));
        if (grantId) {
          const [grant] = await tx.select().from(mailProviderGrants).where(eq(mailProviderGrants.id, grantId)).for("update");
          if (!grant) throw new ServiceError("conflict", "Restore the original carrier grant witness.");
          await tx.update(mailProviderGrants).set({ carrierOperations: grant.carrierOperations.map(prior => prior.id === id ? { ...prior, ...patch } : prior), ...(grant.withdrawnAt && operation.kind === "consent" && outcome.state !== "refused" ? { recoveryPending: true, withdrawalError: "A later original consent outcome contradicts the prior withdrawal. Verify the original resource again; the erased address will not be restored." } : {}), updatedAt: new Date() }).where(eq(mailProviderGrants.id, grantId));
        }
      });
      // The observed provider witness commits first. Recovery of an older
      // privacy artifact must never roll that positive fact back.
      if (grantId) {
        const { reopenCarrierErasures } = await import("./carrier-recovery");
        await reopenCarrierErasures([grantId]);
      }
    }
  } };
}
