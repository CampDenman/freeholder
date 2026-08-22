// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Project records (C6.15, MASTER.md §4.7).
//
// The claims worth proving:
//
//   1. **A project links rather than copies.** The invoice on a project is the
//      invoice in the ledger, so there is never a second answer to what the
//      customer owes.
//   2. **It is the same entity C8.01 will publish**, which is why the slug is
//      unique and stable and why `clientDisplayName` exists.
//   3. **Before/after is a pairing**, not two uploads, enforced in both
//      directions so neither half can exist without the other's key.
//   4. **Erasure keeps the work and forgets the person** — a project is the
//      business's own record of what it did.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { assets } from "@/core/media/schema";
import { contacts } from "@/core/contacts/schema";
import { projectFiles, projectLinks, projects } from "@/modules/projects/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  addTask,
  attachFile,
  createProject,
  getProject,
  linkToProject,
  listProjects,
  projectsForSubject,
  removeTask,
  setOutcome,
  setTaskStatus,
  unlinkFromProject,
  updateProject,
} from "@/modules/projects/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("projects", { timeout: 90_000 }, () => {
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

  async function project(overrides: Record<string, unknown> = {}) {
    return createProject.call(
      { title: "Henderson kitchen", contactId: await contactId(), ...overrides },
      OWNER,
    );
  }

  async function asset(): Promise<string> {
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: `test/${crypto.randomUUID()}.jpg`,
        filename: "before.jpg",
        mime: "image/jpeg",
        legacyBytes: 1_024,
        bytes: 1_024,
      })
      .returning({ id: assets.id });
    return created!.id;
  }

  it("names itself for the web without anybody inventing a slug", async () => {
    const created = await project();
    expect(created.slug).toBe("henderson-kitchen");
    expect(created.status).toBe("enquiry");
  });

  // The slug is the address C8.01 will publish at, so a collision is a naming
  // decision rather than an internal error.
  it("refuses two projects at the same web address", async () => {
    await project();
    const clash = await failure(project());
    expect(clash.message).toContain("web address");
  });

  it("records work with no client at all", async () => {
    const internal = await createProject.call({ title: "Rebuild our own site" }, OWNER);
    expect(internal.contactId).toBeNull();
  });

  // The whole point of the record: one place where the quote, the agreement,
  // the bookings and the invoice are the same job.
  it("gathers a job's paperwork without copying any of it", async () => {
    const created = await project();
    const quoteId = "00000000-0000-4000-8000-000000000001";
    const invoiceId = "00000000-0000-4000-8000-000000000002";
    await linkToProject.call(
      { projectId: created.id, kind: "quote", targetId: quoteId, label: "Q-0001" },
      OWNER,
    );
    await linkToProject.call(
      { projectId: created.id, kind: "invoice", targetId: invoiceId },
      OWNER,
    );

    const full = await getProject.call({ id: created.id }, OWNER);
    expect(full?.links).toHaveLength(2);
    // Pointers, not copies: nothing here restates a total.
    expect(full?.links.map((link) => link.targetId)).toContain(invoiceId);
  });

  it("treats attaching the same thing twice as one attachment", async () => {
    const created = await project();
    const quoteId = "00000000-0000-4000-8000-000000000001";
    await linkToProject.call({ projectId: created.id, kind: "quote", targetId: quoteId }, OWNER);
    await linkToProject.call(
      { projectId: created.id, kind: "quote", targetId: quoteId, label: "Q-0001" },
      OWNER,
    );
    const rows = await db().select().from(projectLinks);
    expect(rows).toHaveLength(1);
    // The label is refreshed rather than duplicated.
    expect(rows[0]!.label).toBe("Q-0001");
  });

  it("takes something off a project without deleting it", async () => {
    const created = await project();
    const link = await linkToProject.call(
      { projectId: created.id, kind: "booking", targetId: "00000000-0000-4000-8000-000000000003" },
      OWNER,
    );
    await unlinkFromProject.call({ id: link.id }, OWNER);
    const full = await getProject.call({ id: created.id }, OWNER);
    expect(full?.links).toHaveLength(0);
    // The project itself is untouched — only the attachment went.
    expect(full?.title).toBe("Henderson kitchen");
  });

  // So an invoice screen can say "part of the Henderson kitchen" without
  // invoicing learning what a project is.
  it("answers which project something belongs to", async () => {
    const created = await project();
    const invoiceId = "00000000-0000-4000-8000-000000000002";
    await linkToProject.call({ projectId: created.id, kind: "invoice", targetId: invoiceId }, OWNER);
    const found = await projectsForSubject.call(
      { kind: "invoice", targetId: invoiceId },
      OWNER,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("Henderson kitchen");
  });

  it("keeps a list of what has to happen, in order", async () => {
    const created = await project();
    const first = await addTask.call({ projectId: created.id, title: "Measure up" }, OWNER);
    const second = await addTask.call({ projectId: created.id, title: "Order units" }, OWNER);
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);

    const done = await setTaskStatus.call({ id: first.id, status: "done" }, OWNER);
    expect(done.doneAt).toBeTruthy();
    // Cleared on the way back out, so "done on" is always the moment it was
    // actually marked rather than the first time it ever was.
    const undone = await setTaskStatus.call({ id: first.id, status: "doing" }, OWNER);
    expect(undone.doneAt).toBeNull();

    await removeTask.call({ id: second.id }, OWNER);
    const full = await getProject.call({ id: created.id }, OWNER);
    expect(full?.tasks).toHaveLength(1);
  });

  it("counts what is still open on each job", async () => {
    const created = await project();
    await addTask.call({ projectId: created.id, title: "Measure up" }, OWNER);
    const second = await addTask.call({ projectId: created.id, title: "Order units" }, OWNER);
    await setTaskStatus.call({ id: second.id, status: "done" }, OWNER);

    const listed = await listProjects.call({}, OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.openTasks).toBe(1);
    expect(listed[0]?.contactName).toBe("Rae Lane");
  });

  it("stamps the finish rather than letting anybody type it", async () => {
    const created = await project();
    const complete = await updateProject.call(
      { id: created.id, status: "complete" },
      OWNER,
    );
    expect(complete.completedAt).toBeTruthy();
    const [row] = await db().select().from(projects).where(eq(projects.id, created.id));
    expect(row!.status).toBe("complete");
  });

  it("records what the work achieved and how it was measured", async () => {
    const created = await project();
    await setOutcome.call(
      {
        projectId: created.id,
        label: "Time on site",
        value: "40",
        unit: "%",
        method: "First-party analytics, three months either side.",
      },
      OWNER,
    );
    const full = await getProject.call({ id: created.id }, OWNER);
    expect(full?.outcomes[0]).toMatchObject({ label: "Time on site", value: "40" });
    // The claim and the substantiation sit together, which is what makes an
    // owner notice when they cannot fill the second.
    expect(full?.outcomes[0]?.method).toContain("analytics");
  });

  // §4.7: "Before/after is a pairing, not two uploads."
  it("insists a before and an after are actually paired", async () => {
    const created = await project();
    const naked = await failure(
      attachFile.call({ projectId: created.id, assetId: await asset(), role: "before" }, OWNER),
    );
    expect(naked.message).toContain("pair name");

    const stray = await failure(
      attachFile.call(
        { projectId: created.id, assetId: await asset(), role: "gallery", pairKey: "kitchen" },
        OWNER,
      ),
    );
    expect(stray.message).toContain("Only a before or after");

    const before = await attachFile.call(
      { projectId: created.id, assetId: await asset(), role: "before", pairKey: "kitchen" },
      OWNER,
    );
    const after = await attachFile.call(
      { projectId: created.id, assetId: await asset(), role: "after", pairKey: "kitchen" },
      OWNER,
    );
    expect(before.pairKey).toBe("kitchen");
    expect(after.pairKey).toBe("kitchen");
    const rows = await db().select().from(projectFiles);
    expect(rows).toHaveLength(2);
  });

  it("keeps the work and forgets the person", async () => {
    const created = await project({ clientDisplayName: "The Hendersons" });
    await updateProject.call({ id: created.id, notes: "Difficult about the tiles." }, OWNER);
    const [contact] = await db()
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.projects");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, contact!.id, { requestId: "t" }));

    const [after] = await db().select().from(projects).where(eq(projects.id, created.id));
    // The business's own record of what it did survives; the person does not.
    expect(after).toMatchObject({
      title: "Henderson kitchen",
      contactId: null,
      clientDisplayName: null,
      notes: null,
    });
  });

  it("moves a job to the record that survives a merge", async () => {
    await project();
    const { contactReferences } = await import("@/core/contacts/service");
    expect(contactReferences().some((one) => one.table === "projects")).toBe(true);
  });
});
