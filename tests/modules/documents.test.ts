// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Documents shared with a client (MASTER.md §4.5, C8.13).
//
// The tests worth reading first are the ones about a history that has to hold
// up: that a revision never overwrites the one before it, that a share pinned
// to version 2 keeps showing version 2 after version 3 arrives, and that every
// way a link can fail leaves a row saying which way it was.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { assets } from "@/core/media/schema";
import {
  documentAccessLogs,
  documentShares,
  documentVersions,
  documents,
} from "@/modules/documents/schema";
import {
  accessHistory,
  addVersion,
  exportDocument,
  listDocuments,
  openShare,
  revokeShare,
  saveDocument,
  share,
  shares,
  versions,
} from "@/modules/documents/service";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function contact(email: string, name = "Rae") {
  const { contact: found } = await resolveContact.call({ email, name }, OWNER);
  return found;
}

async function file(filename = "contract.pdf", overrides: Record<string, unknown> = {}) {
  const [asset] = await db()
    .insert(assets)
    .values({
      kind: "doc",
      storageKey: `test/${crypto.randomUUID()}.pdf`,
      filename,
      mime: "application/pdf",
      legacyBytes: 1024,
      bytes: 1024,
      status: "ready",
      ...overrides,
    })
    .returning();
  return asset!;
}

/**
 * Open a share and insist it worked.
 *
 * `documents.open` returns `{ ok: false }` rather than throwing when it
 * refuses, so the denial row commits — see `deny` in the service. That makes
 * the happy path a narrowing, and this keeps the narrowing out of every test.
 */
async function opened_(token: string, action: "view" | "download" = "view", password?: string) {
  const result = await openShare.call({ token, action, ...(password ? { password } : {}) }, ANONYMOUS);
  if (!result.ok) throw new Error("expected the share to open");
  return result;
}

/** Open a share and insist it was refused. */
async function refused(token: string, action: "view" | "download" = "view", password?: string) {
  const result = await openShare.call({ token, action, ...(password ? { password } : {}) }, ANONYMOUS);
  expect(result.ok).toBe(false);
}

/** A document with one version, belonging to a client. */
async function documentWithFile(title = "Kitchen drawings") {
  const client = await contact("client@example.com", "Nils");
  const document = await saveDocument.call({ title, contactId: client.id }, OWNER);
  const asset = await file();
  const version = await addVersion.call(
    { documentId: document.id, assetId: asset.id, note: "First issue" },
    OWNER,
  );
  return { client, document, asset, version };
}

describe.runIf(hasDatabase)("documents shared with a client", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  /* ------------------------------------------------------- versioning */

  it("revises rather than replaces", async () => {
    // §4.5: "Uploading a new file against a document writes a
    // DocumentVersion; it never overwrites the last one."
    const { document } = await documentWithFile();
    const second = await file("contract-v2.pdf");
    await addVersion.call(
      { documentId: document.id, assetId: second.id, note: "Signed" },
      OWNER,
    );

    const history = await versions.call({ documentId: document.id }, OWNER);
    expect(history).toHaveLength(2);
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    // The first version still points at the file it always pointed at.
    expect(history[1]!.note).toBe("First issue");
  });

  it("numbers versions from one, contiguously", async () => {
    const { document } = await documentWithFile();
    for (const name of ["b.pdf", "c.pdf"]) {
      await addVersion.call({ documentId: document.id, assetId: (await file(name)).id }, OWNER);
    }
    const history = await versions.call({ documentId: document.id }, OWNER);
    expect(history.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("moves the document's current version to the newest", async () => {
    const { document } = await documentWithFile();
    const second = await file("v2.pdf");
    const created = await addVersion.call(
      { documentId: document.id, assetId: second.id },
      OWNER,
    );
    const [row] = await db().select().from(documents).where(eq(documents.id, document.id));
    expect(row!.currentVersionId).toBe(created.id);
  });

  it("refuses to share a file that is not ready", async () => {
    // Sending somebody a quarantined upload is the moment it stops being
    // reversible, so the check belongs here rather than at the download.
    const { document } = await documentWithFile();
    const quarantined = await file("bad.pdf", { status: "quarantined" });
    await expect(
      addVersion.call({ documentId: document.id, assetId: quarantined.id }, OWNER),
    ).rejects.toThrow(/not ready/i);
  });

  it("refuses a file that failed its virus scan", async () => {
    const { document } = await documentWithFile();
    const infected = await file("bad.pdf", { scanStatus: "infected" });
    await expect(
      addVersion.call({ documentId: document.id, assetId: infected.id }, OWNER),
    ).rejects.toThrow(/virus scan/i);
  });

  /* ---------------------------------------------------------- sharing */

  it("opens a link share and records the view", async () => {
    const { document } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "link" },
      OWNER,
    );
    expect(created.token).toBeTruthy();

    const opened = await opened_(created.token!, "view");
    expect(opened.documentId).toBe(document.id);
    expect(opened.version).toBe(1);

    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe("view");
  });

  it("returns the token once and never stores it", async () => {
    // A leaked database must not be a set of working share links.
    const { document } = await documentWithFile();
    const created = await share.call({ documentId: document.id, access: "link" }, OWNER);
    const [row] = await db()
      .select()
      .from(documentShares)
      .where(eq(documentShares.id, created.shareId));
    expect(row!.tokenHash).not.toBe(created.token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("follows the current version unless pinned", async () => {
    const { document } = await documentWithFile();
    const created = await share.call({ documentId: document.id, access: "link" }, OWNER);
    await addVersion.call({ documentId: document.id, assetId: (await file("v2.pdf")).id }, OWNER);

    const opened = await opened_(created.token!);
    expect(opened.version).toBe(2);
  });

  it("keeps a pinned share on the version it was sent about", async () => {
    // §4.5: "pinned is what a countersigned contract needs ... guessing
    // between them is how somebody signs the wrong page."
    const { document, version } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "link", pinnedVersionId: version.id },
      OWNER,
    );
    await addVersion.call({ documentId: document.id, assetId: (await file("v2.pdf")).id }, OWNER);

    const opened = await opened_(created.token!);
    expect(opened.version).toBe(1);
  });

  it("wants a password for a password share, and checks it", async () => {
    const { document } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "password", password: "correct horse" },
      OWNER,
    );
    await refused(created.token!, "view", "wrong");

    const opened = await opened_(created.token!, "view", "correct horse");
    expect(opened.version).toBe(1);
  });

  it("refuses to configure a password share with no password", async () => {
    const { document } = await documentWithFile();
    await expect(
      share.call({ documentId: document.id, access: "password" }, OWNER),
    ).rejects.toThrow(/password/i);
  });

  it("refuses to share a document with no file in it", async () => {
    const empty = await saveDocument.call({ title: "Nothing yet" }, OWNER);
    await expect(
      share.call({ documentId: empty.id, access: "link" }, OWNER),
    ).rejects.toThrow(/add a file/i);
  });

  it("refuses an expiry that has already passed", async () => {
    const { document } = await documentWithFile();
    await expect(
      share.call(
        {
          documentId: document.id,
          access: "link",
          expiresAt: new Date(Date.now() - 60_000),
        },
        OWNER,
      ),
    ).rejects.toThrow(/already in the past/i);
  });

  /* ---------------------------------------------- refusals, on the record */

  it("records an expired open as a denial with its reason", async () => {
    const { document } = await documentWithFile();
    const created = await share.call({ documentId: document.id, access: "link" }, OWNER);
    await db()
      .update(documentShares)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(documentShares.id, created.shareId));

    await refused(created.token!);

    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe("denied");
    // The owner learns which of the four ways it failed; the visitor did not.
    expect(history[0]!.reason).toBe("expired");
  });

  it("records a revoked open as a denial, and keeps the share", async () => {
    const { document } = await documentWithFile();
    const created = await share.call({ documentId: document.id, access: "link" }, OWNER);
    await revokeShare.call({ shareId: created.shareId }, OWNER);

    await refused(created.token!);

    // "We took that back on the 4th" is a fact somebody may need to prove.
    const listed = await shares.call({ documentId: document.id }, OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.revokedAt).not.toBeNull();

    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history[0]!.reason).toBe("revoked");
  });

  it("records a wrong password as a denial", async () => {
    const { document } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "password", password: "correct horse" },
      OWNER,
    );
    await refused(created.token!, "view", "nope");
    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history[0]!.reason).toBe("secret");
  });

  it("refuses a download on a view-only share, and says so on the record", async () => {
    const { document } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "link", downloadPolicy: "none" },
      OWNER,
    );
    // Viewing is still fine.
    await opened_(created.token!, "view");
    await refused(created.token!, "download");

    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history[0]!.reason).toBe("policy");
  });

  it("enforces a download limit, counting downloads and not views", async () => {
    // A limit is about copies leaving. Counting views would mean a client who
    // opened the page twice could no longer fetch what they were sent.
    const { document } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "link", downloadLimit: 2 },
      OWNER,
    );
    await opened_(created.token!, "view");
    await opened_(created.token!, "view");
    await opened_(created.token!, "download");
    await opened_(created.token!, "download");

    await refused(created.token!, "download");

    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history[0]!.reason).toBe("limit");
  });

  it("says nothing useful about an unknown token", async () => {
    await refused("not-a-real-token-at-all");
    // Nothing to log against, so nothing is logged — and the visitor cannot
    // tell this apart from a revoked link, which is the right way round.
    expect(await db().select().from(documentAccessLogs)).toHaveLength(0);
  });

  /* --------------------------------------------------------- the record */

  it("exports the whole history, denials included", async () => {
    // §4.5: an export that omitted the denials would be the flattering half.
    const { document } = await documentWithFile();
    const created = await share.call({ documentId: document.id, access: "link" }, OWNER);
    await opened_(created.token!, "download");
    await revokeShare.call({ shareId: created.shareId }, OWNER);
    await refused(created.token!);

    const exported = await exportDocument.call({ documentId: document.id }, OWNER);
    expect(exported.versions).toHaveLength(1);
    expect(exported.shares).toHaveLength(1);
    expect(exported.access.map((a) => a.action)).toEqual(["download", "denied"]);
  });

  it("keeps the access history when two contacts merge", async () => {
    // §4.5: "a document history that vanishes the first time two duplicates
    // are merged is not an audit."
    const { mergeContacts } = await import("@/core/contacts/service");
    const { client, document } = await documentWithFile();
    const created = await share.call(
      { documentId: document.id, access: "link", contactId: client.id },
      OWNER,
    );
    await opened_(created.token!, "view");
    const dupe = await contact("nils.second@example.com", "Nils");

    await mergeContacts.call({ duplicateId: dupe.id, survivingId: client.id }, OWNER);

    const history = await accessHistory.call({ documentId: document.id }, OWNER);
    expect(history).toHaveLength(1);
    expect(history[0]!.contactId).toBe(client.id);
  });

  it("shows a customer only what was shared with them", async () => {
    const { client, document } = await documentWithFile();
    await share.call({ documentId: document.id, access: "link" }, OWNER);
    const other = await contact("other@example.com", "Kit");

    expect(await listDocuments.call({ contactId: client.id }, OWNER)).toHaveLength(1);
    expect(await listDocuments.call({ contactId: other.id }, OWNER)).toHaveLength(0);
  });

  it("marks a document shared the first time it is shared", async () => {
    const { document } = await documentWithFile();
    expect(document.status).toBe("draft");
    await share.call({ documentId: document.id, access: "link" }, OWNER);
    const [row] = await db().select().from(documents).where(eq(documents.id, document.id));
    expect(row!.status).toBe("shared");
  });

  it("has no way to edit a version once written", async () => {
    // The structural half of "immutable once written": no updated_at, and no
    // service that could set one.
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const columns = getTableConfig(documentVersions).columns.map((c) => c.name);
    expect(columns).not.toContain("updated_at");
  });
});
