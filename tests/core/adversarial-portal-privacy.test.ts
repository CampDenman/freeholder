// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.11/C8.13/C8.17: owning a contact does not grant the owner's private drafts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { createQuote, listQuotes, sendQuote, setQuoteItems } from "@/modules/quotes/service";
import { addVersion, listDocuments, saveDocument, share } from "@/modules/documents/service";
import { createProject, listProjects } from "@/modules/projects/service";
import { projects } from "@/modules/projects/schema";
import { createDraftInvoice, issueInvoice, listInvoices } from "@/modules/invoicing/invoice-service";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("adversarial own-contact reads", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call({ name: "Portal privacy", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" }, OWNER);
  });
  afterAll(closeDb);

  async function customer() {
    const { contact } = await resolveContact.call({ name: "Portal customer", email: "portal-customer@example.test" }, OWNER);
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    return contact;
  }

  it("keeps unsent quotes and staff notes out of customer list responses", async () => {
    const contact = await customer();
    const draft = await createQuote.call({ contactId: contact.id, title: "Unsent negotiations", notes: "PRIVATE STAFF NEGOTIATION" }, OWNER);
    expect(await listQuotes.call({ contactId: contact.id }, CUSTOMER)).toEqual([]);
    expect(await listQuotes.call({ contactId: contact.id, status: "draft" }, CUSTOMER)).toEqual([]);
    await setQuoteItems.call({ id: draft.id, items: [{ description: "Coverage", unitPriceMinor: 10_000 }] }, OWNER);
    await sendQuote.call({ id: draft.id }, OWNER);
    const customerRows = await listQuotes.call({ contactId: contact.id }, CUSTOMER);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0]!.notes).toBeNull();
    expect(JSON.stringify(customerRows)).not.toContain("PRIVATE STAFF NEGOTIATION");
    expect((await listQuotes.call({ contactId: contact.id }, OWNER))[0]!.notes).toBe("PRIVATE STAFF NEGOTIATION");
    expect((await failure(listQuotes.call({}, CUSTOMER))).code).toBe("permission");
  });

  it("exposes document metadata only after sharing rather than merely assigning a contact", async () => {
    const contact = await customer();
    const document = await saveDocument.call({ contactId: contact.id, title: "Private draft", description: "INTERNAL DRAFT DOCUMENT" }, OWNER);
    expect(await listDocuments.call({ contactId: contact.id }, CUSTOMER)).toEqual([]);
    expect(await listDocuments.call({ contactId: contact.id, status: "draft" }, CUSTOMER)).toEqual([]);
    expect(await listDocuments.call({ contactId: contact.id }, OWNER)).toHaveLength(1);
    const [asset] = await db().insert(assets).values({ kind: "doc", storageKey: `test/${crypto.randomUUID()}.pdf`, filename: "shared.pdf", mime: "application/pdf", legacyBytes: 10, bytes: 10 }).returning();
    await addVersion.call({ documentId: document.id, assetId: asset!.id }, OWNER);
    await share.call({ documentId: document.id, contactId: contact.id, access: "login" }, OWNER);
    expect((await listDocuments.call({ contactId: contact.id }, CUSTOMER))[0]!.id).toBe(document.id);
  });

  it("hides owner project notes and unpublished case-study copy from its customer", async () => {
    const contact = await customer();
    const project = await createProject.call({ contactId: contact.id, title: "Client work", notes: "PRIVATE PROJECT NOTES" }, OWNER);
    await db().update(projects).set({ blocks: [{ id: "private-copy", type: "text", props: { body: "UNPUBLISHED CASE STUDY" } }], seo: { description: "UNPUBLISHED SEO" } }).where(eq(projects.id, project.id));
    const customerRows = await listProjects.call({ contactId: contact.id }, CUSTOMER);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0]!.notes).toBeNull();
    expect(customerRows[0]!.blocks).toEqual([]);
    expect(customerRows[0]!.seo).toEqual({});
    expect(JSON.stringify(customerRows)).not.toMatch(/PRIVATE PROJECT NOTES|UNPUBLISHED CASE STUDY|UNPUBLISHED SEO/);
    const ownerRows = await listProjects.call({ contactId: contact.id }, OWNER);
    expect(ownerRows[0]!.notes).toBe("PRIVATE PROJECT NOTES");
    expect(JSON.stringify(ownerRows)).toContain("UNPUBLISHED CASE STUDY");
  });

  it("hides draft invoices and internal request identifiers from customer lists", async () => {
    const contact = await customer();
    const draft = await createDraftInvoice.call({
      contactId: contact.id, currency: "CAD", idempotencyKey: "private-invoice-request",
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 10_000 }],
      tax: { mode: "not_applicable", reason: "Test tax policy" },
    }, OWNER);
    expect(await listInvoices.call({ contactId: contact.id }, CUSTOMER)).toEqual([]);
    expect(await listInvoices.call({ contactId: contact.id, status: "draft" }, CUSTOMER)).toEqual([]);
    await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const mine = await listInvoices.call({ contactId: contact.id }, CUSTOMER);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.totalMinor).toBe(10_000);
    for (const field of ["requestHash", "idempotencyKey", "sequenceKey", "paymentRevision"])
      expect(mine[0]).not.toHaveProperty(field);
    const owner = await listInvoices.call({ contactId: contact.id }, OWNER);
    expect(owner[0]!.idempotencyKey).toBe("private-invoice-request");
  });
});
