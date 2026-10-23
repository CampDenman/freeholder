// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Freeholder's consent ledger, as a permission-checking mail provider needs
// to see it (C3.31, MASTER.md §12).
//
// Some mail adapters (`requiresPermission`) refuse campaign mail unless they
// hold a direct opt-in for the recipient, and keep their own record of every
// grant and withdrawal. The proof is Freeholder's: `consent_records` is
// immutable evidence of each decision. This file translates that evidence,
// never invents it.
//
// - A grant is offered only from a method a provider can accept as direct
//   permission: a confirmed double opt-in, a person's own preference-centre
//   choice (an affirmative, unticked-by-default control), or a signed form.
//   Imports, verbal notes and system records stay here; they are not proof a
//   provider can accept, so a campaign to those people is refused.
// - Grants Freeholder records at a carrier are remembered
//   (`mail_provider_grants`), with the address each was recorded under.
// - A withdrawal is mirrored as soon as it commits, and only for those
//   grants: a contact who denied, never opted in, or was never mailed there
//   has nothing at the carrier to withdraw. The address is the grant's, so a
//   contact whose email has changed since is withdrawn where the carrier
//   actually holds them.
import { isIP } from "node:net";
import { and, eq, isNull } from "drizzle-orm";
import { MailAdapterError, type MarketingConsentEvidence } from "@/adapters/mail/types";
import { db } from "@/core/db";
import { playgroundBlocksExternalDelivery } from "@/core/demo/playground-policy";
import { env } from "@/core/env";
import { mailProviderGrants } from "@/core/mail/schema";
import { consentRecords } from "@/core/privacy/schema";

type ConsentRecord = typeof consentRecords.$inferSelect;

const DIRECT_PERMISSION_METHODS: Partial<Record<ConsentRecord["method"], MarketingConsentEvidence["method"]>> = {
  double_opt_in: "double_opt_in",
  preference_center: "unchecked_checkbox",
  written: "signed_form",
  contract: "signed_form",
};

function wording(evidence: unknown): string | undefined {
  if (!evidence || typeof evidence !== "object") return undefined;
  const record = evidence as Record<string, unknown>;
  for (const key of ["statement", "wording", "label", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length >= 10) return value.trim().slice(0, 4000);
  }
  return undefined;
}

/**
 * The grant evidence for one retained Freeholder record, or null when the
 * record is not proof a provider can accept.
 *
 * When the words shown at collection were not retained, the statement says
 * what the record is rather than reconstructing wording nobody kept.
 */
export function consentEvidenceFromRecord(
  record: Pick<ConsentRecord, "id" | "state" | "method" | "termsVersion" | "sourceUrl" | "ip" | "evidence" | "occurredAt">,
  appUrl: string,
): MarketingConsentEvidence | null {
  if (record.state !== "granted") return null;
  const method = DIRECT_PERMISSION_METHODS[record.method];
  if (!method) return null;
  const origin = new URL(appUrl).origin;
  let source = origin;
  if (record.sourceUrl) {
    try {
      // The page, not whatever rode along in its address: a query string or
      // fragment can carry tokens or a visitor's own details.
      const url = new URL(record.sourceUrl, origin);
      url.search = "";
      url.hash = "";
      source = url.href.slice(0, 2000);
    } catch {
      source = origin;
    }
  }
  const statement =
    wording(record.evidence) ??
    `Marketing email permission recorded by ${record.method.replace("_", " ")}` +
      `${record.termsVersion ? ` under terms version ${record.termsVersion}` : ""}` +
      ` (Freeholder consent record ${record.id}).`;
  return {
    collectedAt: record.occurredAt.toISOString(),
    method,
    statement,
    source,
    evidenceRef: `freeholder-consent:${record.id}`,
    ...(record.ip && isIP(record.ip) ? { recipientIp: record.ip } : {}),
  };
}

/** The current marketing-email grant for a contact, as provider evidence. */
export async function marketingEvidence(contactId: string): Promise<MarketingConsentEvidence | null> {
  const { canContact } = await import("@/core/privacy/service");
  const consent = await canContact.call(
    { contactId, purpose: "marketing", channel: "email" },
    { kind: "system" },
  );
  if (!consent.allowed || !consent.evidenceId) return null;
  const [record] = await db()
    .select()
    .from(consentRecords)
    .where(and(eq(consentRecords.id, consent.evidenceId), eq(consentRecords.contactId, contactId)))
    .limit(1);
  return record ? consentEvidenceFromRecord(record, env().APP_URL) : null;
}

const EVIDENCE_PREFIX = "freeholder-consent:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remember a grant a carrier recorded while sending, from its evidence reference. */
export async function rememberProviderGrant(
  provider: string,
  grant: { email: string; evidenceRef: string },
): Promise<void> {
  if (provider !== "paradise" || !grant.evidenceRef.startsWith(EVIDENCE_PREFIX)) return;
  const consentRecordId = grant.evidenceRef.slice(EVIDENCE_PREFIX.length);
  if (!UUID.test(consentRecordId)) return;
  await db()
    .insert(mailProviderGrants)
    .values({ provider, email: grant.email.trim().toLowerCase(), consentRecordId })
    .onConflictDoNothing();
}

/**
 * Mirror a marketing-email withdrawal to the configured campaign carrier,
 * for every grant Freeholder recorded there for this contact.
 *
 * An outbox listener. A transient failure throws, and the outbox retries it
 * with backoff, so a provider outage delays the mirror without losing it. A
 * permanent refusal is recorded on the grant and logged once, never retried
 * into a dead letter; the public playground skips it silently. Freeholder's
 * own ledger already stops the next campaign either way — the delivery
 * worker rechecks consent immediately before every send.
 */
export async function mirrorMarketingWithdrawal(payload: unknown): Promise<void> {
  const event = (payload ?? {}) as {
    contactId?: string;
    purpose?: string;
    channel?: string | null;
    state?: string;
  };
  if (event.purpose !== "marketing" || event.channel !== "email") return;
  // A denial was never a grant, so the carrier holds nothing to withdraw.
  if (event.state !== "withdrawn") return;
  if (!event.contactId) return;
  if (playgroundBlocksExternalDelivery(env())) return;
  const { bulkMail, mailConfigurationStatus } = await import("@/adapters/mail");
  if (!mailConfigurationStatus().bulk.sendConfigured) return;
  const carrier = bulkMail();
  if (!carrier.recordWithdrawal || carrier.id !== "paradise") return;
  const grants = await db()
    .select({ id: mailProviderGrants.id, email: mailProviderGrants.email })
    .from(mailProviderGrants)
    .innerJoin(consentRecords, eq(consentRecords.id, mailProviderGrants.consentRecordId))
    .where(
      and(
        eq(consentRecords.contactId, event.contactId),
        eq(mailProviderGrants.provider, carrier.id),
        isNull(mailProviderGrants.withdrawnAt),
        isNull(mailProviderGrants.withdrawalError),
      ),
    );
  // One call per address the carrier holds, however many grants led there.
  const byEmail = new Map<string, string[]>();
  for (const grant of grants) byEmail.set(grant.email, [...(byEmail.get(grant.email) ?? []), grant.id]);
  for (const [email, ids] of byEmail) {
    try {
      await carrier.recordWithdrawal(email);
    } catch (error) {
      if (!(error instanceof MailAdapterError) || error.retryable) throw error;
      const message = error.message.slice(0, 500);
      for (const id of ids) {
        await db()
          .update(mailProviderGrants)
          .set({ withdrawalError: message, updatedAt: new Date() })
          .where(eq(mailProviderGrants.id, id));
      }
      console.warn(
        `[mail] The campaign carrier refused to record a marketing withdrawal (${error.providerCode ?? error.httpStatus ?? "refused"}); Freeholder's own ledger still stops every campaign to this contact.`,
      );
      continue;
    }
    for (const id of ids) {
      await db()
        .update(mailProviderGrants)
        .set({ withdrawnAt: new Date(), updatedAt: new Date() })
        .where(eq(mailProviderGrants.id, id));
    }
  }
}
