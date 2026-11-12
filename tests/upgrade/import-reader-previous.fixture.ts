// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Run only in an unchanged prior worktree, using that worktree's @ aliases.
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { resolveContact, updateContact } from "@/core/contacts/service";
import { startImport, previewFromSource, commitImport } from "@/core/import/service";
import { contacts } from "@/core/contacts/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { importRuns } from "@/core/plugins/schema";
import { OWNER, closeDb, truncateSpine } from "../helpers/spine";
import { READER_UPGRADE_EMAIL, READER_UPGRADE_SOURCE, readerTableSnapshots } from "./import-reader-data";

const actor = { kind: "agent" as const, keyName: "fictional-original-reader-executor", scopes: ["imports.start", "imports.previewFromSource"] };
const path = process.env.FREEHOLDER_READER_UPGRADE_EVIDENCE!;
afterAll(async () => { await stopJobs(); await closeDb(); });
it("uses the actual previous source writer, then refuses that writer after the normal upgrade", async () => {
  if (process.env.FREEHOLDER_READER_UPGRADE_PHASE === "before") {
    await truncateSpine();
    const committedPrivate = process.env.FREEHOLDER_READER_UPGRADE_COMMITTED_PRIVATE === "1";
    if (committedPrivate) await ensureDefaults.call({}, OWNER);
    let original = committedPrivate ? undefined : (await resolveContact.call({ name: "Fictional original reader", email: READER_UPGRADE_EMAIL }, OWNER)).contact;
    const run = await startImport.call({ origin: "https://fictional-reader-upgrade.example/", kind: "wordpress-wxr" }, actor);
    await previewFromSource.call({ id: run.id, payload: committedPrivate ? READER_UPGRADE_SOURCE.replace("<wp:comment_approved>1", "<wp:comment_approved>0") : READER_UPGRADE_SOURCE }, actor);
    if (committedPrivate) {
      await commitImport.call({ id: run.id }, OWNER);
      [original] = await db().select().from(contacts).where(eq(contacts.email, READER_UPGRADE_EMAIL));
      expect(original?.source).toBe("wordpress-comment");
    }
    const [stored] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    if (!original) throw new Error("The prior source did not supply its actual reader contact.");
    if (!committedPrivate) expect(JSON.stringify(stored!.preview)).toContain(original.id);
    if (!committedPrivate) await updateContact.call({ id: original.id, email: "fictional-original-now-changed@example.test" }, OWNER);
    const candidate = committedPrivate ? original : (await resolveContact.call({ name: "Fictional later address holder", email: READER_UPGRADE_EMAIL }, OWNER)).contact;
    await stopJobs();
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      writeFileSync(path, JSON.stringify({ id: run.id, originalId: original.id, candidateId: candidate.id, createdBy: stored!.createdBy, snapshots: await readerTableSnapshots(client) }, null, 2));
    } finally { await client.end(); }
  } else {
    const fixture = JSON.parse(readFileSync(path, "utf8")) as { id: string; originalId: string; snapshots: Record<string, { count: number; hash: string }> };
    const failure = await previewFromSource.call({ id: fixture.id, payload: READER_UPGRADE_SOURCE }, actor).then(() => undefined, (error: unknown) => error);
    const errors: Array<{ code?: string; message?: string }> = [];
    let cause = failure;
    while (cause && typeof cause === "object" && errors.length < 8) {
      errors.push(cause);
      cause = (cause as { cause?: unknown }).cause;
    }
    expect(errors.some(error => error.code === "55000" && /guarded reader ownership writer/.test(error.message ?? "")) || errors.some(error => /schema/i.test(error.message ?? "") && /runtime|upgrade|newer/i.test(error.message ?? ""))).toBe(true);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const snapshots = await readerTableSnapshots(client);
      for (const table of ["contacts", "import_runs", "blog_reader_comments"]) expect(snapshots[table]).toEqual(fixture.snapshots[table]);
    } finally { await client.end(); }
  }
});
