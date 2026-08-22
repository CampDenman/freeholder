// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Contract templates, countersignature and export (C6.14, MASTER.md §4.3).
//
// C6.09 proved what a signature is. This proves the authoring half does not
// weaken it:
//
//   1. **Variables are replaced, never evaluated**, and a value that happens
//      to contain `{{something}}` cannot reach into the document.
//   2. **Templates are versioned**, so a document issued last month still
//      names what it was rendered from after the owner rewrites the terms.
//   3. **The customer signs first.** Countersigning an unsigned document would
//      produce something the business has agreed to and the customer has not,
//      which is an offer rather than an agreement.
//   4. **The export is checkable.** A fingerprint nobody can recompute is
//      decoration, so the exported file carries the words *and* the hashes.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contractDocuments, contractTemplates } from "@/modules/contracts/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { renderTemplate, variablesIn } from "@/modules/contracts/templates";
import {
  archiveTemplate,
  countersignContract,
  exportContract,
  issueFromTemplate,
  listTemplates,
  previewTemplate,
  saveTemplate,
} from "@/modules/contracts/template-service";
import { getContract, signContract } from "@/modules/contracts/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ANON = { kind: "anonymous" } as const;
const BODY =
  "This agreement is between {{business_name}} and {{customer_name}}, dated {{today}}.";

describe("filling in a template", () => {
  it("finds the variables a body actually mentions, once each", () => {
    expect(variablesIn("{{a}} and {{ b }} and {{a}}")).toEqual(["a", "b"]);
  });

  it("replaces what it is given", () => {
    const out = renderTemplate("Dear {{customer_name}},", { customer_name: "Rae Lane" });
    expect(out.body).toBe("Dear Rae Lane,");
    expect(out.missing).toEqual([]);
  });

  // "Dear ," is wrong only to the person receiving it; `{{customer_name}}` is
  // wrong to whoever proofreads it, which is the point at which it can be
  // fixed.
  it("leaves an unsupplied variable visible rather than blanking it", () => {
    const out = renderTemplate("Dear {{customer_name}},", {});
    expect(out.body).toBe("Dear {{customer_name}},");
    expect(out.missing).toEqual(["customer_name"]);
  });

  it("uses the fallback the owner wrote before calling it missing", () => {
    const out = renderTemplate("Notice: {{notice_days}} days", {}, [
      { key: "notice_days", label: "Notice", fallback: "30" },
    ]);
    expect(out.body).toBe("Notice: 30 days");
    expect(out.missing).toEqual([]);
  });

  // The reason for a single pass rather than a replace per variable: a value
  // containing `{{...}}` must not be substituted on a later pass. A customer
  // whose company name happens to contain braces cannot reach into the
  // contract.
  it("does not let a value reach back into the document", () => {
    const out = renderTemplate("Client: {{customer_name}}. Fee: {{fee}}.", {
      customer_name: "{{fee}} Ltd",
      fee: "£10,000",
    });
    expect(out.body).toBe("Client: {{fee}} Ltd. Fee: £10,000.");
  });

  it("treats a template with no variables as finished", () => {
    const out = renderTemplate("Nothing to fill in.", {});
    expect(out).toEqual({ body: "Nothing to fill in.", missing: [] });
  });
});

describe.runIf(hasDatabase)("templates, countersigning and export", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function contactId(): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function template(overrides: Record<string, unknown> = {}) {
    return saveTemplate.call(
      {
        name: "Studio terms",
        kind: "agreement",
        title: "Studio terms for {{customer_name}}",
        body: BODY,
        variables: [{ key: "customer_name", label: "Customer", fallback: null }],
        ...overrides,
      },
      OWNER,
    );
  }

  it("tells the owner which variables they have not described", async () => {
    const saved = await template();
    // `business_name` and `today` are the platform's to fill; the point of the
    // list is that the owner knows what the template is asking for.
    expect(saved.undeclared).toEqual(["business_name", "today"]);
  });

  it("writes a new version rather than editing the old one", async () => {
    const first = await template();
    const second = await template({ body: "Rewritten terms for {{customer_name}}." });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);

    const all = await db().select().from(contractTemplates);
    expect(all).toHaveLength(2);
    // The first version's words are exactly where they were.
    expect(all.find((row) => row.version === 1)?.body).toBe(BODY);
  });

  it("shows an owner what a customer would actually receive", async () => {
    const saved = await template();
    const preview = await previewTemplate.call(
      { id: saved.id, contactId: await contactId() },
      OWNER,
    );
    expect(preview.body).toContain("Rae Lane");
    expect(preview.body).not.toContain("{{customer_name}}");
    // This instance has no business profile yet, so `business_name` has
    // nothing to fill it — and the preview says so plainly rather than
    // rendering "between  and Rae Lane" for the owner to miss.
    expect(preview.missing).toEqual(["business_name"]);
    expect(preview.body).toContain("{{business_name}}");
  });

  it("issues through the same door a hand-typed waiver goes through", async () => {
    const saved = await template();
    const issued = await issueFromTemplate.call(
      { templateId: saved.id, contactId: await contactId(), subjectType: "contact" },
      OWNER,
    );
    const document = await getContract.call({ id: issued.id }, OWNER);
    // A snapshot, as always: the rendered words rather than a pointer to a
    // template somebody may rewrite tomorrow.
    expect(document?.body).toContain("Rae Lane");
    expect(document?.bodyIntact).toBe(true);
    expect(document?.templateId).toBe(saved.id);
  });

  it("holds the words it was issued with when the template is rewritten", async () => {
    const saved = await template();
    const issued = await issueFromTemplate.call(
      { templateId: saved.id, contactId: await contactId() },
      OWNER,
    );
    await template({ body: "Completely different terms nobody agreed to." });

    const document = await getContract.call({ id: issued.id }, OWNER);
    expect(document?.body).toContain("This agreement is between");
    expect(document?.body).not.toContain("Completely different");
  });

  it("will not issue from a template that has been withdrawn", async () => {
    const saved = await template();
    await archiveTemplate.call({ id: saved.id }, OWNER);
    const refused = await failure(
      issueFromTemplate.call({ templateId: saved.id, contactId: await contactId() }, OWNER),
    );
    expect(refused.message).toContain("archived");

    // Archived, not deleted: documents issued from it still name it.
    const live = await listTemplates.call({}, OWNER);
    expect(live).toHaveLength(0);
    const withArchived = await listTemplates.call({ includeArchived: true }, OWNER);
    expect(withArchived).toHaveLength(1);
  });

  // Countersigning first would produce a document the business has agreed to
  // and the customer has not, which is an offer rather than an agreement.
  it("makes the customer sign before the business does", async () => {
    const saved = await template({ requiresCountersignature: true });
    const issued = await issueFromTemplate.call(
      { templateId: saved.id, contactId: await contactId() },
      OWNER,
    );
    const early = await failure(
      countersignContract.call({ id: issued.id, signerName: "The Owner" }, OWNER),
    );
    expect(early.message).toContain("customer signs first");

    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    const done = await countersignContract.call(
      { id: issued.id, signerName: "The Owner" },
      OWNER,
    );
    expect(done.countersignedAt).toBeTruthy();
    const twice = await failure(
      countersignContract.call({ id: issued.id, signerName: "The Owner" }, OWNER),
    );
    expect(twice.message).toContain("already been countersigned");
  });

  it("carries the countersignature rule onto the document itself", async () => {
    const saved = await template({ requiresCountersignature: true });
    const issued = await issueFromTemplate.call(
      { templateId: saved.id, contactId: await contactId() },
      OWNER,
    );
    const [row] = await db()
      .select({ requires: contractDocuments.requiresCountersignature })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    // The document knows its own rules without asking a template that may
    // have been archived since.
    expect(row!.requires).toBe(true);
  });

  // A fingerprint nobody can recompute is decoration.
  it("exports something a third party can actually check", async () => {
    const saved = await template();
    const issued = await issueFromTemplate.call(
      { templateId: saved.id, contactId: await contactId() },
      OWNER,
    );
    const [row] = await db()
      .select({ token: contractDocuments.signToken, body: contractDocuments.bodySnapshot })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    await signContract.call(
      { token: row!.token!, signerName: "Rae Lane", ip: "203.0.113.7" },
      ANON,
    );

    const file = await exportContract.call({ id: issued.id }, OWNER);
    expect(file.filename).toMatch(/\.txt$/);
    expect(file.body).toContain("Rae Lane");
    expect(file.body).toContain("203.0.113.7");
    // The words in the file hash to the fingerprint printed in the file.
    const hash = createHash("sha256").update(row!.body, "utf8").digest("hex");
    expect(file.body).toContain(hash);
  });
});
