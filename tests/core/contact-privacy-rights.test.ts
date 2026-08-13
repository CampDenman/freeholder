// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Consent evidence and privacy-rights proof (MASTER.md C1.08).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { GET as downloadArtifactRoute } from "../../app/privacy/artifacts/[id]/route";
import {
  contacts,
  customerMagicLinks,
  timelineEvents,
} from "@/core/contacts/schema";
import {
  createContact,
  mergeContacts,
  undoContactMerge,
} from "@/core/contacts/service";
import { createRelationship } from "@/core/contacts/relationships";
import {
  consentRecords,
  dataRequestArtifacts,
  dataRequests,
} from "@/core/privacy/schema";
import {
  addRetentionException,
  canContact,
  createDataRequest,
  createMyDataRequest,
  downloadDataRequestArtifact,
  downloadMyDataRequestArtifact,
  fulfillDataRequest,
  getConsentPreferences,
  getMyPrivacyProfile,
  pruneExpiredPrivacyArtifacts,
  recordConsent,
  setMyMarketingPreference,
  startDataRequest,
  verifyDataRequest,
} from "@/core/privacy/service";
import { db } from "@/core/db";
import { analyticsEvents } from "@/modules/analytics/schema";
import { forms, formSubmissions } from "@/modules/forms/schema";
import type { Actor } from "@/core/service";
import {
  OWNER,
  STAFF,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

async function customer(name = "Privacy Customer", email = "privacy@example.test") {
  const [user] = await db()
    .insert(users)
    .values({ email, role: "customer" })
    .returning();
  const [contact] = await db()
    .insert(contacts)
    .values({ userId: user!.id, name, email })
    .returning();
  const actor: Extract<Actor, { kind: "user" }> = {
    kind: "user",
    userId: user!.id,
    role: "customer",
    grants: [],
  };
  return { user: user!, contact: contact!, actor };
}

describe.runIf(hasDatabase)("contact consent and privacy rights", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("derives preferences from append-only, expiring consent evidence", async () => {
    const contact = await createContact.call(
      { name: "Consent Person", email: "consent@example.test" },
      STAFF,
    );
    const actor = { ...STAFF, request: { ip: "203.0.113.10" } };
    const granted = await recordConsent.call(
      {
        contactId: contact.id,
        purpose: "marketing",
        channel: "email",
        state: "granted",
        method: "written",
        termsVersion: "marketing-2026-08",
        evidence: { document: "signed-card" },
      },
      actor,
    );
    await recordConsent.call(
      {
        contactId: contact.id,
        purpose: "marketing",
        channel: "email",
        state: "withdrawn",
        method: "verbal",
        evidence: {},
      },
      STAFF,
    );
    await db().insert(consentRecords).values({
      contactId: contact.id,
      purpose: "analytics",
      channel: "web",
      state: "granted",
      method: "form",
      actor: "system",
      occurredAt: new Date(Date.now() - 48 * 60 * 60 * 1_000),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
    });

    const profile = await getConsentPreferences.call(
      { contactId: contact.id },
      STAFF,
    );
    expect(profile.history).toHaveLength(3);
    expect(profile.history.find((row) => row.id === granted.id)).toMatchObject({
      ip: "203.0.113.10",
      termsVersion: "marketing-2026-08",
      evidence: { document: "signed-card" },
    });
    expect(
      profile.effective.find(
        (choice) => choice.purpose === "marketing" && choice.channel === "email",
      ),
    ).toMatchObject({ state: "withdrawn" });
    expect(
      profile.effective.find((choice) => choice.purpose === "analytics"),
    ).toMatchObject({ state: "expired" });
    expect(
      await canContact.call(
        { contactId: contact.id, purpose: "marketing", channel: "email" },
        STAFF,
      ),
    ).toMatchObject({ allowed: false, reason: "withdrawn" });
    expect(
      await canContact.call(
        { contactId: contact.id, purpose: "marketing", channel: "sms" },
        STAFF,
      ),
    ).toMatchObject({ allowed: false, evidenceId: null });
  });

  it("enforces consent pairing and request lifecycle invariants in PostgreSQL", async () => {
    const contact = await createContact.call({ name: "Constraint Person" }, STAFF);
    await expect(
      db().insert(consentRecords).values({
        contactId: contact.id,
        purpose: "marketing",
        channel: "web",
        state: "granted",
        method: "form",
        actor: "system",
      }),
    ).rejects.toThrow();
    await expect(
      db().insert(dataRequests).values({
        contactId: contact.id,
        kind: "access",
        status: "completed",
        requestedBy: "system",
        responseDueAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });

  it("keeps the preference centre personal and preserves its evidence history", async () => {
    const first = await customer();
    const second = await customer("Other Customer", "other@example.test");
    await setMyMarketingPreference.call(
      { channel: "sms", state: "granted", termsVersion: "portal-v1" },
      first.actor,
    );
    await setMyMarketingPreference.call(
      { channel: "sms", state: "withdrawn", termsVersion: "portal-v1" },
      first.actor,
    );
    expect((await getMyPrivacyProfile.call({}, first.actor)).history).toHaveLength(2);
    expect((await getMyPrivacyProfile.call({}, second.actor)).history).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.contactId, first.contact.id)),
    ).toHaveLength(2);
  });

  it("verifies and exports real module data through a protected checksummed file", async () => {
    const person = await customer();
    const [form] = await db()
      .insert(forms)
      .values({ slug: "privacy-export", name: "Privacy export" })
      .returning();
    await db().insert(formSubmissions).values({
      formId: form!.id,
      contactId: person.contact.id,
      data: { message: "Please include this" },
      sourceUrl: "/contact",
    });
    await db().insert(analyticsEvents).values({
      anonId: "privacy-browser",
      sessionId: "privacy-session",
      contactId: person.contact.id,
      name: "page.viewed",
      path: "/private-history",
      props: { campaign: "summer" },
    });
    await db().insert(customerMagicLinks).values({
      contactId: person.contact.id,
      email: person.contact.email!,
      tokenHash: "sensitive-token-hash",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const request = await createDataRequest.call(
      {
        contactId: person.contact.id,
        jurisdiction: "CA-BC",
        request: { kind: "export", note: "Customer wrote by email." },
      },
      STAFF,
    );
    expect(request.status).toBe("submitted");
    expect(
      Math.abs(
        request.responseDueAt.getTime() -
          request.createdAt.getTime() -
          30 * 24 * 60 * 60 * 1_000,
      ),
    ).toBeLessThan(1_000);
    await verifyDataRequest.call(
      { id: request.id, method: "Matched authenticated support callback" },
      STAFF,
    );
    await startDataRequest.call({ id: request.id }, STAFF);
    const fulfilled = await fulfillDataRequest.call({ id: request.id }, OWNER);
    expect(fulfilled.request.status).toBe("completed");

    const downloaded = await downloadDataRequestArtifact.call(
      { id: fulfilled.artifact.id },
      OWNER,
    );
    expect(downloaded.filename).toMatch(/^freeholder-export-/);
    expect(
      createHash("sha256").update(downloaded.content).digest("hex"),
    ).toBe(downloaded.sha256);
    expect(downloaded.content).toContain("Please include this");
    expect(downloaded.content).toContain("/private-history");
    expect(downloaded.content).not.toContain("sensitive-token-hash");

    const session = await db().transaction((tx) =>
      createSession(tx, person.user.id),
    );
    const response = await downloadArtifactRoute(
      new Request(`http://freeholder.test/privacy/artifacts/${fulfilled.artifact.id}`, {
        headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
      }),
      { params: Promise.resolve({ id: fulfilled.artifact.id }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="freeholder-export-/,
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-freeholder-content-sha256")).toBe(
      downloaded.sha256,
    );
    expect(await response.text()).toContain("Please include this");

    const anonymous = await downloadArtifactRoute(
      new Request(`http://freeholder.test/privacy/artifacts/${fulfilled.artifact.id}`),
      { params: Promise.resolve({ id: fulfilled.artifact.id }) },
    );
    expect(anonymous.status).toBe(401);

    const stranger = await customer("Stranger", "stranger@example.test");
    expect(
      (
        await failure(
          downloadMyDataRequestArtifact.call(
            { id: fulfilled.artifact.id },
            stranger.actor,
          ),
        )
      ).code,
    ).toBe("not_found");
  });

  it("applies only reviewed correction fields and issues a receipt", async () => {
    const person = await customer("Needs Correction", "wrong@example.test");
    const request = await createMyDataRequest.call(
      {
        jurisdiction: "CA",
        request: {
          kind: "correction",
          changes: {
            name: "Correct Name",
            email: "correct@example.test",
            country: "ca",
          },
        },
      },
      person.actor,
    );
    const fulfilled = await fulfillDataRequest.call({ id: request.id }, OWNER);
    expect(fulfilled.request.status).toBe("completed");
    expect(
      (await db().select().from(contacts).where(eq(contacts.id, person.contact.id)))[0],
    ).toMatchObject({
      name: "Correct Name",
      email: "correct@example.test",
      country: "CA",
    });
    const receipt = await downloadMyDataRequestArtifact.call(
      { id: fulfilled.artifact.id },
      person.actor,
    );
    expect(receipt.content).toContain("correct@example.test");
  });

  it("erases every registered scope, revokes customer access, and leaves a suppression record", async () => {
    const person = await customer("Erase Me", "erase@example.test");
    const other = await createContact.call({ name: "Related Person" }, STAFF);
    await createRelationship.call(
      {
        fromContactId: person.contact.id,
        toContactId: other.id,
        kind: "partner",
        notes: "Personal relationship note",
      },
      STAFF,
    );
    const [form] = await db()
      .insert(forms)
      .values({ slug: "privacy-erasure", name: "Privacy erasure" })
      .returning();
    const [submission] = await db()
      .insert(formSubmissions)
      .values({
        formId: form!.id,
        contactId: person.contact.id,
        data: { secret: "erase this answer" },
        sourceUrl: "/secret",
      })
      .returning();
    const [analytics] = await db()
      .insert(analyticsEvents)
      .values({
        anonId: "erase-browser",
        sessionId: "erase-session",
        contactId: person.contact.id,
        name: "page.viewed",
        path: "/kept-for-aggregate-counts",
        referrer: "private.example",
        locale: "en-CA",
        props: { private: "erase" },
      })
      .returning();
    await db().insert(customerMagicLinks).values({
      contactId: person.contact.id,
      email: person.contact.email!,
      tokenHash: "erase-token",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await recordConsent.call(
      {
        contactId: person.contact.id,
        purpose: "marketing",
        channel: "email",
        state: "granted",
        method: "form",
        termsVersion: "old-personal-proof",
        sourceUrl: "/secret",
        evidence: { name: "Erase Me" },
      },
      STAFF,
    );
    const request = await createMyDataRequest.call(
      { request: { kind: "erasure", note: "Erase every personal field." } },
      person.actor,
    );
    const result = await fulfillDataRequest.call(
      { id: request.id, confirmation: "ERASE" },
      OWNER,
    );
    expect(result.request.status).toBe("completed");
    expect(
      (await db().select().from(contacts).where(eq(contacts.id, person.contact.id)))[0],
    ).toMatchObject({
      userId: null,
      name: "Erased contact",
      email: null,
      phone: null,
      orgId: null,
      customFields: {},
      ownerNotes: null,
    });
    expect(await db().select().from(users).where(eq(users.id, person.user.id))).toEqual([]);
    expect(
      await db()
        .select()
        .from(customerMagicLinks)
        .where(eq(customerMagicLinks.contactId, person.contact.id)),
    ).toEqual([]);
    expect(
      (await db()
        .select()
        .from(formSubmissions)
        .where(eq(formSubmissions.id, submission!.id)))[0],
    ).toMatchObject({ data: {}, sourceUrl: null, spamReasons: [] });
    expect(
      (await db()
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.id, analytics!.id)))[0],
    ).toMatchObject({ contactId: null, referrer: null, locale: null, props: {} });
    const history = await db()
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, person.contact.id));
    expect(history.some((row) => row.termsVersion === "old-personal-proof")).toBe(false);
    expect(
      history.filter(
        (row) => row.purpose === "marketing" && row.state === "withdrawn",
      ),
    ).toHaveLength(3);
    expect(
      (await db()
        .select()
        .from(timelineEvents)
        .where(eq(timelineEvents.contactId, person.contact.id)))
        .every((event) =>
          event.eventType === "contact.dataErased" ||
          event.eventType === "contact.dataRequestCompleted"
            ? true
            : JSON.stringify(event.payload) === JSON.stringify({ erased: true }),
        ),
    ).toBe(true);
    const receipt = await downloadDataRequestArtifact.call(
      { id: result.artifact.id },
      OWNER,
    );
    expect(receipt.content).not.toContain("Erase Me");
    expect(receipt.content).not.toContain("erase@example.test");
  });

  it("retains only a named legal-exception scope and reports partial completion", async () => {
    const person = await customer();
    const [event] = await db()
      .insert(analyticsEvents)
      .values({
        anonId: "retained-browser",
        sessionId: "retained-session",
        contactId: person.contact.id,
        name: "order.attributed",
        path: "/receipt",
      })
      .returning();
    const request = await createMyDataRequest.call(
      { request: { kind: "erasure" } },
      person.actor,
    );
    await addRetentionException.call(
      {
        dataRequestId: request.id,
        scope: "analytics.events",
        reason: "legal_claim",
        legalBasis: "Documented dispute file 2026-14",
      },
      STAFF,
    );
    const result = await fulfillDataRequest.call(
      { id: request.id, confirmation: "ERASE" },
      OWNER,
    );
    expect(result.request.status).toBe("partially_completed");
    expect(
      (await db()
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.id, event!.id)))[0]?.contactId,
    ).toBe(person.contact.id);
    const receipt = await downloadDataRequestArtifact.call(
      { id: result.artifact.id },
      OWNER,
    );
    expect(receipt.content).toContain("Documented dispute file 2026-14");
    expect(receipt.content).toContain("partially_completed");
  });

  it("refuses to erase a staff-capable login and rolls the transaction back", async () => {
    const [user] = await db()
      .insert(users)
      .values({ email: "staff-contact@example.test", role: "staff" })
      .returning();
    const [contact] = await db()
      .insert(contacts)
      .values({
        userId: user!.id,
        name: "Staff Contact",
        email: "staff-contact@example.test",
      })
      .returning();
    const request = await createDataRequest.call(
      { contactId: contact!.id, request: { kind: "erasure" } },
      STAFF,
    );
    await verifyDataRequest.call({ id: request.id, method: "Government ID" }, STAFF);
    const error = await failure(
      fulfillDataRequest.call(
        { id: request.id, confirmation: "ERASE" },
        OWNER,
      ),
    );
    expect(error).toMatchObject({ code: "conflict" });
    expect(
      (await db().select().from(contacts).where(eq(contacts.id, contact!.id)))[0],
    ).toMatchObject({ name: "Staff Contact", email: "staff-contact@example.test" });
    expect(
      (await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]
        ?.status,
    ).toBe("verified");
  });

  it("repoints privacy records during merge and restores them on safe undo", async () => {
    const survivor = await createContact.call({ name: "Privacy Survivor" }, STAFF);
    const duplicate = await createContact.call({ name: "Privacy Duplicate" }, STAFF);
    const consent = await recordConsent.call(
      {
        contactId: duplicate.id,
        purpose: "marketing",
        channel: "email",
        state: "granted",
        method: "written",
        evidence: {},
      },
      STAFF,
    );
    const request = await createDataRequest.call(
      { contactId: duplicate.id, request: { kind: "access" } },
      STAFF,
    );
    const merged = await mergeContacts.call(
      { survivingId: survivor.id, duplicateId: duplicate.id },
      STAFF,
    );
    expect(
      (await db().select().from(consentRecords).where(eq(consentRecords.id, consent.id)))[0]
        ?.contactId,
    ).toBe(survivor.id);
    expect(
      (await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]
        ?.contactId,
    ).toBe(survivor.id);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, STAFF);
    expect(
      (await db().select().from(consentRecords).where(eq(consentRecords.id, consent.id)))[0]
        ?.contactId,
    ).toBe(duplicate.id);
    expect(
      (await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]
        ?.contactId,
    ).toBe(duplicate.id);
  });

  it("enforces step-up, confirmation, artifact expiry, and pruning", async () => {
    const person = await customer();
    const request = await createMyDataRequest.call(
      { request: { kind: "erasure" } },
      person.actor,
    );
    const noStepUp = {
      ...OWNER,
      security: {
        twoFactorRequired: true,
        twoFactorEnrolled: true,
        twoFactorVerified: true,
        stepUpValid: false,
      },
    };
    expect(
      (await failure(fulfillDataRequest.call({ id: request.id }, noStepUp))).code,
    ).toBe("step_up_required");
    expect(
      (await failure(fulfillDataRequest.call({ id: request.id }, OWNER))).code,
    ).toBe("validation");

    const exportRequest = await createMyDataRequest.call(
      { request: { kind: "export" } },
      person.actor,
    );
    const result = await fulfillDataRequest.call({ id: exportRequest.id }, OWNER);
    await db()
      .update(dataRequestArtifacts)
      .set({
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      })
      .where(eq(dataRequestArtifacts.id, result.artifact.id));
    expect(
      (
        await failure(
          downloadMyDataRequestArtifact.call(
            { id: result.artifact.id },
            person.actor,
          ),
        )
      ).code,
    ).toBe("not_found");
    expect(await pruneExpiredPrivacyArtifacts()).toBe(1);
  });
});

describe("contact privacy migration", () => {
  it("is additive and carries the required constraints and indexes", () => {
    const migration = readFileSync(
      "db/migrations/0024_contact-privacy-rights.sql",
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "consent_records"');
    expect(migration).toContain('CREATE TABLE "data_requests"');
    expect(migration).toContain('CREATE TABLE "data_request_artifacts"');
    expect(migration).toContain('CREATE TABLE "privacy_retention_exceptions"');
    expect(migration).toContain('CONSTRAINT "consent_records_purpose_channel"');
    expect(migration).toContain('CREATE INDEX "data_requests_status_due_idx"');
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(migration).not.toContain('ALTER TABLE "contacts"');
  });
});
