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
// - Withdrawals are mirrored as soon as they commit, so a provider's ledger
//   never says "granted" for somebody who has just asked to stop.
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import type { MarketingConsentEvidence } from "@/adapters/mail/types";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { env } from "@/core/env";
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
      source = new URL(record.sourceUrl, origin).href.slice(0, 2000);
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

/**
 * Mirror a marketing-email withdrawal to the configured campaign carrier,
 * when that carrier keeps its own consent ledger.
 *
 * An outbox listener: a failure throws, and the outbox retries it with
 * backoff, so a provider outage delays the mirror without losing it.
 * Freeholder's own ledger already stops the next campaign either way — the
 * delivery worker rechecks consent immediately before every send.
 */
export async function mirrorMarketingWithdrawal(payload: unknown): Promise<void> {
  const event = (payload ?? {}) as {
    contactId?: string;
    purpose?: string;
    channel?: string | null;
    state?: string;
  };
  if (event.purpose !== "marketing" || event.channel !== "email") return;
  if (event.state !== "withdrawn" && event.state !== "denied") return;
  if (!event.contactId) return;
  const { bulkMail, mailConfigurationStatus } = await import("@/adapters/mail");
  if (!mailConfigurationStatus().bulk.sendConfigured) return;
  const carrier = bulkMail();
  if (!carrier.recordWithdrawal) return;
  const [contact] = await db()
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, event.contactId))
    .limit(1);
  if (!contact?.email) return;
  await carrier.recordWithdrawal(contact.email);
}
