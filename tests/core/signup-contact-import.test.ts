// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import {
  contactRelationships,
  contacts,
} from "@/core/contacts/schema";
import { connectedAccounts } from "@/core/connections/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { auditLog } from "@/core/events/schema";
import {
  contactImportRows,
  contactImports,
  signupContactImportChoices,
} from "@/core/import/contacts-schema";
import {
  readGoogleContacts,
  readMicrosoftContacts,
} from "@/core/import/signup-contact-providers";
import {
  beginSignupContactsOAuth,
  commitSignupContactImport,
  completeSignupContactsOAuth,
  disconnectSignupContacts,
  getSignupContactImportOffer,
  listSignupProviderContacts,
  revertSignupContactImport,
  setSignupContactImportPolicy,
  skipSignupContactImport,
  stageDeviceContacts,
  stageSignupContactFile,
  stageSignupProviderContacts,
} from "@/core/import/signup-contact-service";
import { parseVCard } from "@/core/import/vcard";
import { staffInvitations } from "@/core/auth/schema";
import { consentRecords } from "@/core/privacy/schema";
import { messages } from "@/core/messaging/schema";
import { newsletterSubscriptions } from "@/modules/newsletters/schema";
import { ready } from "@/core/runtime";
import type { Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000711";
const OTHER_ID = "00000000-0000-4000-8000-000000000712";
const CUSTOMER: Actor = { kind: "user", userId: CUSTOMER_ID, role: "customer", grants: [] };
const OTHER: Actor = { kind: "user", userId: OTHER_ID, role: "customer", grants: [] };
const STAFF: Actor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000713",
  role: "staff",
  grants: [{ module: "signupContactImports", access: "manage" }],
};

describe("vCard's bounded field reader", () => {
  it("unfolds cards and retains only name, email, and phone", () => {
    expect(
      parseVCard([
        "BEGIN:VCARD",
        "VERSION:3.0",
        "N:Lane;Rae;;;",
        "FN:Rae Lane",
        "EMAIL;TYPE=HOME:Rae@Example.Test",
        "TEL;TYPE=CELL:+1 604 555 0100",
        "NOTE:a field Freeholder must not retain",
        "END:VCARD",
      ].join("\r\n")),
    ).toEqual([{ name: "Rae Lane", email: "rae@example.test", phone: "+1 604 555 0100" }]);
  });
});

describe("least-privilege provider contact reads", () => {
  it("asks Google only for owner-enabled fields", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      return new Response(JSON.stringify({
        connections: [{
          resourceName: "people/c1",
          names: [{ displayName: "Rae Lane", metadata: { primary: true } }],
          emailAddresses: [{ value: "rae@example.test", metadata: { primary: true } }],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const found = await readGoogleContacts("token", ["email", "name"], 10);
    expect(found[0]).toMatchObject({ externalId: "people/c1", name: "Rae Lane" });
    const url = new URL(calls[0]!);
    expect(url.searchParams.get("personFields")).toBe("names,emailAddresses");
    expect(url.searchParams.get("personFields")).not.toContain("phoneNumbers");
    expect(url.searchParams.getAll("sources")).toEqual(["READ_SOURCE_TYPE_CONTACT"]);
    vi.unstubAllGlobals();
  });

  it("uses Microsoft Contacts.Read data with an exact $select", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      return new Response(JSON.stringify({
        value: [{ id: "c1", emailAddresses: [{ address: "sam@example.test" }], mobilePhone: "555" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const found = await readMicrosoftContacts("token", ["email", "phone"], 10);
    expect(found[0]).toMatchObject({ externalId: "c1", email: "sam@example.test", phone: "555" });
    const url = new URL(calls[0]!);
    expect(url.searchParams.get("$select")).toBe("id,emailAddresses,businessPhones,mobilePhone");
    expect(url.searchParams.get("$select")).not.toContain("displayName");
    vi.unstubAllGlobals();
  });
});

describe.runIf(hasDatabase)("optional post-signup contact import", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: CUSTOMER_ID, email: "customer@example.test", role: "customer" },
      { id: OTHER_ID, email: "other@example.test", role: "customer" },
      { id: STAFF.userId, email: "staff@example.test", role: "staff" },
    ]);
    await db().insert(contacts).values([
      { name: "Customer", email: "customer@example.test", userId: CUSTOMER_ID, source: "portal" },
      { name: "Other", email: "other@example.test", userId: OTHER_ID, source: "portal" },
    ]);
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await truncateSpine();
    await closeDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetEnvForTests();
  });

  async function enable(options?: { maxContacts?: number; fields?: Array<"email" | "name" | "phone"> }) {
    return setSignupContactImportPolicy.call({
      enabled: true,
      allowedSources: ["google", "microsoft", "vcard", "csv", "device"],
      allowedFields: options?.fields ?? ["email", "name", "phone"],
      maxContacts: options?.maxContacts ?? 20,
    }, OWNER);
  }

  it("is off until the owner explicitly enables a signup flow", async () => {
    const offer = await getSignupContactImportOffer.call({}, CUSTOMER);
    expect(offer).toMatchObject({ enabled: false, allowedSources: [], decision: null });
    expect((await failure(stageDeviceContacts.call({
      contacts: [{ email: "rae@example.test" }],
      fields: ["email"],
    }, CUSTOMER))).code).toBe("permission");
  });

  it("does not let staff widen owner policy", async () => {
    expect((await failure(setSignupContactImportPolicy.call({
      enabled: true,
      allowedSources: ["google"],
      allowedFields: ["email"],
      maxContacts: 500,
    }, STAFF))).message).toContain("Only the owner");
  });

  it("enforces allowed source, field, and count before retaining rows", async () => {
    await setSignupContactImportPolicy.call({
      enabled: true,
      allowedSources: ["device"],
      allowedFields: ["email", "name"],
      maxContacts: 1,
    }, OWNER);
    expect((await failure(stageSignupContactFile.call({
      source: "csv",
      filename: "x.csv",
      content: "email\nrae@example.test",
      fields: ["email"],
    }, CUSTOMER))).code).toBe("permission");
    expect((await failure(stageDeviceContacts.call({
      contacts: [{ email: "a@example.test" }],
      fields: ["email", "phone"],
    }, CUSTOMER))).message).toContain("not enabled");
    expect((await failure(stageDeviceContacts.call({
      contacts: [{ email: "a@example.test" }, { email: "b@example.test" }],
      fields: ["email"],
    }, CUSTOMER))).message).toContain("at most 1");
    expect(await db().select().from(contactImportRows)).toHaveLength(0);
  });

  it("stages an exact preview without creating contacts or permission", async () => {
    await enable();
    const batch = await stageDeviceContacts.call({
      contacts: [
        { name: "Rae Lane", email: "rae@example.test", phone: "+1 604 555 0100" },
        { name: "No Address", email: "", phone: "555" },
      ],
      fields: ["email", "name", "phone"],
    }, CUSTOMER);
    expect(batch).toMatchObject({
      sourceKind: "device",
      signupFlow: "portal_account",
      allowedFields: ["email", "name", "phone"],
      status: "validated",
      counts: { create: 1, skip: 1 },
    });
    expect(batch.rows.map((line) => line.cells)).toEqual([
      ["rae@example.test", "Rae Lane", "+1 604 555 0100"],
      ["", "No Address", "555"],
    ]);
    expect(await db().select().from(contacts)).toHaveLength(2);
    expect(await db().select().from(consentRecords)).toHaveLength(0);
    expect(await db().select().from(staffInvitations)).toHaveLength(0);
    expect(await db().select().from(messages)).toHaveLength(0);
    expect(await db().select().from(newsletterSubscriptions)).toHaveLength(0);
  });

  it("attributes commit to the user, resolves the spine, relates, and never opts anyone in", async () => {
    await enable();
    const [subject] = await db().select().from(contacts).where(eq(contacts.userId, CUSTOMER_ID));
    const batch = await stageDeviceContacts.call({
      contacts: [{ name: "Rae Lane", email: "rae@example.test", phone: "555-0100" }],
      fields: ["email", "name", "phone"],
    }, CUSTOMER);
    await commitSignupContactImport.call({ id: batch.id }, CUSTOMER);

    const [rae] = await db().select().from(contacts).where(eq(contacts.email, "rae@example.test"));
    expect(rae).toMatchObject({ name: "Rae Lane", source: "signup:device" });
    const [relationship] = await db().select().from(contactRelationships).where(and(
      eq(contactRelationships.fromContactId, subject!.id),
      eq(contactRelationships.toContactId, rae!.id),
    ));
    expect(relationship?.kind).toBe("contact_book");
    const [ledger] = await db().select().from(contactImportRows).where(eq(contactImportRows.importId, batch.id));
    expect(ledger?.relationshipId).toBe(relationship!.id);
    const [stored] = await db().select().from(contactImports).where(eq(contactImports.id, batch.id));
    expect(stored?.createdBy).toBe(CUSTOMER_ID);
    const outerAudit = await db().select().from(auditLog).where(and(
      eq(auditLog.actor, `user:${CUSTOMER_ID}`),
      eq(auditLog.action, "signupContactImports.commit"),
    ));
    expect(outerAudit).toHaveLength(1);
    expect(await db().select().from(consentRecords)).toHaveLength(0);
    expect(await db().select().from(staffInvitations)).toHaveLength(0);
    expect(await db().select().from(messages)).toHaveLength(0);
    expect(await db().select().from(newsletterSubscriptions)).toHaveLength(0);
  });

  it("resolves an existing email instead of minting another person", async () => {
    await enable();
    await db().insert(contacts).values({ name: "Rae", email: "rae@example.test", source: "form" });
    const batch = await stageDeviceContacts.call({
      contacts: [{ name: "Rae Lane", email: "RAE@example.test", phone: "555" }],
      fields: ["email", "name", "phone"],
    }, CUSTOMER);
    await commitSignupContactImport.call({ id: batch.id }, CUSTOMER);
    const found = await db().select().from(contacts).where(eq(contacts.email, "rae@example.test"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: "form", phone: "555" });
  });

  it("undoes only its relationship and safely reversible contact changes", async () => {
    await enable();
    const batch = await stageSignupContactFile.call({
      source: "vcard",
      filename: "friends.vcf",
      content: "BEGIN:VCARD\nFN:Rae Lane\nEMAIL:rae@example.test\nEND:VCARD",
      fields: ["email", "name"],
    }, CUSTOMER);
    await commitSignupContactImport.call({ id: batch.id }, CUSTOMER);
    const undone = await revertSignupContactImport.call({ id: batch.id }, CUSTOMER);
    expect(undone).toMatchObject({ deleted: 1, kept: 0 });
    expect(await db().select().from(contactRelationships)).toHaveLength(0);
    expect(await db().select().from(contacts).where(eq(contacts.email, "rae@example.test"))).toHaveLength(0);
  });

  it("keeps batches isolated between portal users", async () => {
    await enable();
    const batch = await stageDeviceContacts.call({
      contacts: [{ email: "rae@example.test" }],
      fields: ["email"],
    }, CUSTOMER);
    expect((await failure(commitSignupContactImport.call({ id: batch.id }, OTHER))).code).toBe("not_found");
  });

  it("records skip without changing the completed portal account", async () => {
    await enable();
    await skipSignupContactImport.call({}, CUSTOMER);
    const [choice] = await db().select().from(signupContactImportChoices).where(eq(signupContactImportChoices.userId, CUSTOMER_ID));
    expect(choice?.status).toBe("skipped");
    expect(await db().select().from(users).where(eq(users.id, CUSTOMER_ID))).toHaveLength(1);
  });

  it("asks providers for the documented read-only contact scope", async () => {
    await enable();
    vi.stubEnv("APP_URL", "https://freeholder.example");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "google-secret");
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "microsoft-client");
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "microsoft-secret");
    vi.stubEnv("MICROSOFT_OAUTH_TENANT", "common");
    resetEnvForTests();
    const google = new URL((await beginSignupContactsOAuth.call({ provider: "google" }, CUSTOMER)).authorizationUrl);
    expect(google.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/contacts.readonly");
    expect(google.searchParams.get("scope")).not.toContain("https://www.googleapis.com/auth/contacts ");
    const microsoft = new URL((await beginSignupContactsOAuth.call({ provider: "microsoft" }, CUSTOMER)).authorizationUrl);
    expect(microsoft.searchParams.get("scope")?.split(" ")).toContain("Contacts.Read");
    expect(microsoft.searchParams.get("scope")).not.toContain("Contacts.ReadWrite");
    expect(await db().select().from(connectedAccounts)).toHaveLength(0);
  });

  it("completes Google selection, stages only the chosen contact, and can forget credentials", async () => {
    await enable();
    vi.stubEnv("APP_URL", "https://freeholder.example");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "google-secret");
    vi.stubEnv("CREDENTIAL_KEY", "11".repeat(32));
    resetEnvForTests();
    const begun = await beginSignupContactsOAuth.call({ provider: "google" }, CUSTOMER);
    const state = new URL(begun.authorizationUrl).searchParams.get("state")!;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email profile https://www.googleapis.com/auth/contacts.readonly",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return new Response(JSON.stringify({
          sub: "google-customer-account",
          email: "customer@gmail.example",
          name: "Customer",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("https://people.googleapis.com/")) {
        return new Response(JSON.stringify({
          connections: [
            { resourceName: "people/rae", names: [{ displayName: "Rae" }], emailAddresses: [{ value: "rae@example.test" }] },
            { resourceName: "people/sam", names: [{ displayName: "Sam" }], emailAddresses: [{ value: "sam@example.test" }] },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected provider URL: ${url}`);
    });
    const connected = await completeSignupContactsOAuth.call({
      provider: "google",
      state,
      code: "one-use-code",
    }, CUSTOMER);
    const listed = await listSignupProviderContacts.call({
      accountId: connected.connectedAccountId,
    }, CUSTOMER);
    expect(listed.contacts).toHaveLength(2);
    const batch = await stageSignupProviderContacts.call({
      accountId: connected.connectedAccountId,
      externalIds: ["people/sam"],
    }, CUSTOMER);
    expect(batch).toMatchObject({ sourceKind: "google", counts: { create: 1 } });
    expect(batch.rows).toHaveLength(1);
    expect(batch.rows[0]!.cells).toContain("sam@example.test");
    await disconnectSignupContacts.call({ accountId: connected.connectedAccountId }, CUSTOMER);
    expect(await db().select().from(connectedAccounts)).toHaveLength(0);
    expect(await db().select().from(contactImports).where(eq(contactImports.id, batch.id))).toHaveLength(1);
  });
});

describe("signup contact import migration", () => {
  it("stores policy, choice, attribution, relationship undo, and the portal OAuth return", () => {
    const migration = readFileSync("db/migrations/0116_signup_contact_import.sql", "utf8");
    expect(migration).toContain('CREATE TABLE "signup_contact_import_policies"');
    expect(migration).toContain('CREATE TABLE "signup_contact_import_choices"');
    expect(migration).toContain('ADD COLUMN "subject_contact_id"');
    expect(migration).toContain('ADD COLUMN "relationship_id"');
    expect(migration).toContain("portal/contact-import");
  });
});
