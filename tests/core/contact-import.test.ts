// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importing a contact list (C7.07, MASTER.md §4.1).
//
// C7.07 names the shape — map → validate → dry-run diff → commit → audit →
// reversible batch, always through contact resolution — and each step has a
// characteristic way of going wrong:
//
//   1. **Parsing.** A contact export is exactly the file with a company name
//      containing a comma, an address containing a newline, and a byte-order
//      mark from Excel. A `split(",")` corrupts all three, into the spine.
//   2. **Mapping.** A wrong guess puts a phone number in the name column, and
//      that then propagates through every email the business sends.
//   3. **The dry run.** If the preview and the commit are two implementations,
//      one eventually shows what the other does not do.
//   4. **Resolution.** An import is the path that mints a second record for
//      somebody the business already knows.
//   5. **Reversal.** Undoing must restore what was overwritten, and must not
//      take away work the business has done since.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { contactImportRows } from "@/core/import/contacts-schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { guessDelimiter, guessMapping, parseCsv } from "@/core/import/csv";
import {
  beginContactImport,
  commitContactImport,
  getContactImport,
  mapContactImport,
  revertContactImport,
} from "@/core/import/contacts-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("reading a spreadsheet somebody exported", () => {
  it("keeps a comma that is inside a quoted field", () => {
    // The commonest single corruption: "Smith, Jones & Co" becomes two columns
    // and every field after it shifts by one.
    expect(parseCsv('name,email\n"Smith, Jones & Co",a@b.com')).toEqual([
      ["name", "email"],
      ["Smith, Jones & Co", "a@b.com"],
    ]);
  });

  it("keeps a newline that is inside a quoted field", () => {
    expect(parseCsv('name,address\nRae,"12 High St\nOxford"')).toEqual([
      ["name", "address"],
      ["Rae", "12 High St\nOxford"],
    ]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('name\n"She said ""hello"""')).toEqual([["name"], ['She said "hello"']]);
  });

  // Left in place it becomes part of the first header, and "email" matches
  // nothing.
  it("strips the byte-order mark Excel writes", () => {
    expect(parseCsv("﻿email\na@b.com")).toEqual([["email"], ["a@b.com"]]);
  });

  it("handles Windows line endings without inventing blank rows", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("finds the delimiter a French Excel used", () => {
    expect(guessDelimiter("name;email;phone\nRae;a@b.com;123")).toBe(";");
    expect(guessDelimiter("name,email\nRae,a@b.com")).toBe(",");
    expect(guessDelimiter("name\temail\nRae\ta@b.com")).toBe("\t");
  });

  it("guesses what the headers mean", () => {
    expect(guessMapping(["E-Mail", "Full Name", "Mobile", "Labels", "Notes"])).toEqual([
      "email",
      "name",
      "phone",
      "tags",
      "custom",
    ]);
  });

  // A file with "email" and "email_2" has two facts, and the importer must not
  // choose between them.
  it("does not let a second column claim a field the first already has", () => {
    expect(guessMapping(["email", "email_2"])).toEqual(["email", "custom"]);
  });
});

describe.runIf(hasDatabase)("contact import", { timeout: 90_000 }, () => {
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

  const FILE = [
    "Email,Full Name,Mobile,Country,Labels",
    "rae@example.test,Rae Lane,07700 900001,GB,vip;trade",
    "sam@example.test,Sam Okonjo,,CA,",
    ",Nobody At All,,,",
    "not-an-address,Broken Row,,,",
  ].join("\n");

  async function started(csv = FILE) {
    return beginContactImport.call({ filename: "list.csv", csv }, OWNER);
  }

  async function mapped(csv = FILE) {
    const batch = await started(csv);
    return mapContactImport.call(
      { id: batch.id, mapping: ["email", "name", "phone", "country", "tags"] },
      OWNER,
    );
  }

  it("reads the file and guesses what the columns mean", async () => {
    const batch = await started();
    expect(batch).toMatchObject({
      filename: "list.csv",
      delimiter: ",",
      status: "mapping",
      // A guess an owner corrects, never a decision.
      mapping: ["email", "name", "phone", "country", "tags"],
    });
    const loaded = await getContactImport.call({ id: batch.id }, OWNER);
    expect(loaded!.rows).toHaveLength(4);
    // The first data row is line two, which is what the owner sees when they
    // open the file to fix something.
    expect(loaded!.rows[0]!.lineNumber).toBe(2);
  });

  it("refuses a file with nothing but a header", async () => {
    const refused = await failure(started("email,name"));
    expect(refused.message).toContain("nothing else");
  });

  it("refuses a mapping with no email column", async () => {
    const batch = await started();
    const refused = await failure(
      mapContactImport.call(
        { id: batch.id, mapping: ["name", "name", "phone", "country", "tags"] },
        OWNER,
      ),
    );
    // Without an address every row would be skipped: a silent no-op that looks
    // like a broken import.
    expect(refused.message).toContain("email address");
  });

  it("refuses a mapping that does not fit the file", async () => {
    const batch = await started();
    const refused = await failure(
      mapContactImport.call({ id: batch.id, mapping: ["email"] }, OWNER),
    );
    expect(refused.message).toContain("one entry per column");
  });

  it("says exactly what the file would do, before writing anything", async () => {
    const batch = await mapped();
    expect(batch.status).toBe("validated");
    expect(batch.counts).toMatchObject({ create: 2, skip: 1, error: 1 });
    // And nothing has been written.
    expect(await db().select().from(contacts)).toHaveLength(0);
  });

  it("skips a blank line and flags a broken address separately", async () => {
    const batch = await mapped();
    const loaded = await getContactImport.call({ id: batch.id }, OWNER);
    const byLine = new Map(loaded!.rows.map((line) => [line.lineNumber, line]));
    // A trailing blank row is the commonest thing in any export; calling it a
    // mistake buries the real ones.
    expect(byLine.get(4)).toMatchObject({ outcome: "skip", errors: [] });
    expect(byLine.get(5)!.outcome).toBe("error");
    expect(byLine.get(5)!.errors[0]).toContain("email address");
  });

  it("calls a repeated address in one file an update, not a second person", async () => {
    const batch = await mapped(
      [
        "Email,Full Name,Mobile,Country,Labels",
        "rae@example.test,Rae Lane,,,",
        "rae@example.test,Rae L,,,",
      ].join("\n"),
    );
    expect(batch.counts).toMatchObject({ create: 1, update: 1 });
    const loaded = await getContactImport.call({ id: batch.id }, OWNER);
    expect(loaded!.rows[1]!.errors[0]).toContain("appears earlier");
  });

  it("refuses to apply a file nobody has checked", async () => {
    const batch = await started();
    const refused = await failure(commitContactImport.call({ id: batch.id }, OWNER));
    expect(refused.message).toContain("Check what the file would do");
  });

  it("creates the people it said it would, through the spine", async () => {
    const batch = await mapped();
    const done = await commitContactImport.call({ id: batch.id }, OWNER);
    expect(done.counts).toMatchObject({ created: 2, updated: 0 });

    const [rae] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    expect(rae).toMatchObject({
      name: "Rae Lane",
      phone: "07700 900001",
      country: "GB",
      // A semicolon list in one cell is how every export writes tags.
      tags: ["vip", "trade"],
      source: "import",
    });
    // Only the two usable rows.
    expect(await db().select().from(contacts)).toHaveLength(2);
  });

  // The one failure this whole path exists to prevent.
  it("resolves onto somebody the business already knows", async () => {
    const existing = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "form" },
      { kind: "system" },
    )) as { contact: { id: string } };

    const batch = await mapped();
    expect(batch.counts).toMatchObject({ create: 1, update: 1 });
    const done = await commitContactImport.call({ id: batch.id }, OWNER);
    expect(done.counts).toMatchObject({ created: 1, updated: 1 });

    const found = await db().select().from(contacts).where(eq(contacts.email, "rae@example.test"));
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(existing.contact.id);
    // First-touch attribution is never rewritten, so the import does not claim
    // somebody the form found.
    expect(found[0]!.source).toBe("form");
  });

  it("leaves a case-different address as the same person", async () => {
    await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "form" },
      { kind: "system" },
    );
    const batch = await mapped(
      ["Email,Full Name,Mobile,Country,Labels", " RAE@Example.Test ,Rae Lane,,,"].join("\n"),
    );
    expect(batch.counts).toMatchObject({ create: 0, unchanged: 1 });
  });

  it("refuses to apply the same import twice", async () => {
    const batch = await mapped();
    await commitContactImport.call({ id: batch.id }, OWNER);
    const refused = await failure(commitContactImport.call({ id: batch.id }, OWNER));
    expect(refused.message).toContain("already run");
  });

  it("refuses to re-map an import that has already run", async () => {
    const batch = await mapped();
    await commitContactImport.call({ id: batch.id }, OWNER);
    const refused = await failure(
      mapContactImport.call(
        { id: batch.id, mapping: ["email", "name", "phone", "country", "tags"] },
        OWNER,
      ),
    );
    expect(refused.message).toContain("already run");
  });

  it("keeps what each row overwrote", async () => {
    await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "form" },
      { kind: "system" },
    );
    const batch = await mapped();
    await commitContactImport.call({ id: batch.id }, OWNER);

    const [applied] = await db()
      .select()
      .from(contactImportRows)
      .where(eq(contactImportRows.lineNumber, 2));
    // Restoring is reading these values back, not recomputing them from a file
    // that may since have changed.
    expect(applied!.beforeState).toMatchObject({ phone: null, country: null, tags: [] });
    expect(applied!.created).toBe(false);
  });

  it("undoes an import, putting back what it changed", async () => {
    await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "form" },
      { kind: "system" },
    );
    const batch = await mapped();
    await commitContactImport.call({ id: batch.id }, OWNER);

    const undone = await revertContactImport.call({ id: batch.id }, OWNER);
    expect(undone).toMatchObject({ restored: 1, deleted: 1, kept: 0 });

    const [rae] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    // The person the business already knew is back as they were.
    expect(rae).toMatchObject({ phone: null, country: null, tags: [] });
    // And the person only this file brought in is gone.
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  // The rule that makes undo safe to offer at all.
  it("keeps somebody the import created who has done business since", async () => {
    const batch = await mapped();
    await commitContactImport.call({ id: batch.id }, OWNER);
    const [sam] = await db().select().from(contacts).where(eq(contacts.email, "sam@example.test"));

    // Anything at all referencing them: a task is the cheapest thing to make.
    await getService("tasks.create").call(
      { title: "Ring Sam", subjectType: "contact", subjectId: sam!.id },
      OWNER,
    );

    const undone = await revertContactImport.call({ id: batch.id }, OWNER);
    expect(undone).toMatchObject({ deleted: 1, kept: 1 });
    // The import is undone; the business's later work is not.
    const after = await db().select().from(contacts).where(eq(contacts.id, sam!.id));
    expect(after).toHaveLength(1);
  });

  it("refuses to undo an import that never ran", async () => {
    const batch = await mapped();
    const refused = await failure(revertContactImport.call({ id: batch.id }, OWNER));
    expect(refused.message).toContain("not been applied");
  });

  it("keeps the ledger after an undo, so what happened is still readable", async () => {
    const batch = await mapped();
    await commitContactImport.call({ id: batch.id }, OWNER);
    await revertContactImport.call({ id: batch.id }, OWNER);

    const loaded = await getContactImport.call({ id: batch.id }, OWNER);
    expect(loaded!.status).toBe("reverted");
    expect(loaded!.revertedAt).toBeTruthy();
    expect(loaded!.rows.length).toBe(4);
  });

  // Custom fields are typed and defined by the owner (C1.06); a spreadsheet
  // must not be able to invent one. Refused at the mapping step, naming the
  // column, rather than blowing up halfway through the commit.
  it("refuses a column kept as an extra field that does not exist", async () => {
    const batch = await started(
      ["Email,Membership number", "rae@example.test,A-1234"].join("\n"),
    );
    const refused = await failure(
      mapContactImport.call({ id: batch.id, mapping: ["email", "custom"] }, OWNER),
    );
    expect(refused.message).toContain("Membership number");
    expect(refused.message).toContain("contact fields");
  });

  it("puts a column into a custom field the owner has defined", async () => {
    await getService("contacts.createCustomField").call(
      {
        entity: "contact",
        key: "membership_number",
        label: "Membership number",
        kind: "text",
      },
      OWNER,
    );
    const batch = await started(
      ["Email,membership_number", "rae@example.test,A-1234"].join("\n"),
    );
    await mapContactImport.call({ id: batch.id, mapping: ["email", "custom"] }, OWNER);
    await commitContactImport.call({ id: batch.id }, OWNER);
    const [rae] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    expect(rae!.customFields).toMatchObject({ membership_number: "A-1234" });
  });

  it("throws away a column somebody said to ignore", async () => {
    const batch = await started(
      ["Email,Internal ref", "rae@example.test,do-not-import"].join("\n"),
    );
    await mapContactImport.call({ id: batch.id, mapping: ["email", "ignore"] }, OWNER);
    await commitContactImport.call({ id: batch.id }, OWNER);
    const [rae] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    expect(rae!.customFields).toEqual({});
  });
});
