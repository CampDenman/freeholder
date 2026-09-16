// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded per-kind retention policies (C11.14). Does not add undelete-every-row
// and does not check C11.14.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import manifests from "@/modules";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { listJobs } from "@/core/jobs";
import { conversations } from "@/core/messaging/schema";
import { recordMessage } from "@/core/messaging/service";
import { notes } from "@/core/notes/schema";
import { writeNote } from "@/core/notes/service";
import {
  addRetentionException,
  createDataRequest,
} from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { tasks } from "@/core/tasks/schema";
import { createTask, setTaskStatus } from "@/core/tasks/service";
import {
  RETENTION_TABLE_OPT_OUTS,
  applyRetentionPolicies,
  listRetentionPolicies,
  retentionSources,
  upsertRetentionPolicy,
} from "@/core/retention/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const DAY_MS = 24 * 60 * 60 * 1_000;

describe("C11.14 retention leftovers", () => {
  it("keeps C11.14 open and no longer names per-table TTL as the leftover", () => {
    const master = readFileSync("MASTER.md", "utf8");
    expect(master).toMatch(/- \[ \] \*\*C11\.14\*\*/);
    expect(master).toContain("retention.listPolicies");
    expect(master).toContain("core.applyRetention");
    const remaining = readFileSync("tests/core/record-participation.test.ts", "utf8");
    expect(remaining).toContain(
      "Per-record restore includes note/task trash, media/product restoration, contact-merge undo and the ownership-drill instance restore; other entities still lack undelete.",
    );
    expect(remaining).not.toContain(
      "Retention is privacy-rights + artifact TTL, not a per-table TTL for every user-owned store.",
    );
    expect(master).not.toContain(
      "Retention is privacy-rights + artifact TTL, not a per-table TTL for every user-owned store.",
    );
  });

  it("registers retention services and unique opt-out keys", () => {
    const source = readFileSync("src/core/retention/service.ts", "utf8");
    expect(source).toContain('name: "retention.listPolicies"');
    expect(source).toContain('name: "retention.upsertPolicy"');
    expect(source).toContain('name: "retention.apply"');
    const jobs = readFileSync("src/core/jobs/core-jobs.ts", "utf8");
    expect(jobs).toContain('name: "core.applyRetention"');
    expect(jobs).toMatch(/leaseSeconds:\s*60\s*\*\s*60/);
    const keys = Object.keys(RETENTION_TABLE_OPT_OUTS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(RETENTION_TABLE_OPT_OUTS.consent_records).toMatch(/legal|audit/i);
    expect(RETENTION_TABLE_OPT_OUTS.timeline_events).toMatch(/log|audit|operational/i);
  });

  it("uses unique labels on the retention screen", () => {
    const page = readFileSync("app/(admin)/admin/retention/page.tsx", "utf8");
    expect(page).toContain("admin.retention.kind");
    expect(page).toContain("admin.retention.ttl");
    expect(page).toContain("admin.retention.apply");
    expect(page).toContain("admin.retention.empty");
    expect(page).toContain("admin.retention.unavailable");
    expect(page).toContain("admin.retention.failed");
    expect(page).toContain('htmlFor="retention-kind"');
    expect(page).toContain('htmlFor="retention-ttl"');
    expect(page).not.toMatch(/from "apps\/mobile/);
  });
});

describe.runIf(hasDatabase)("retention policies (C11.14)", { timeout: 90_000 }, () => {
  let tables: PgTable[] = [];

  beforeAll(async () => {
    await ready();
    const found: PgTable[] = [];
    for (const manifest of manifests) {
      if (!manifest.tables) continue;
      const owned: Record<string, unknown> = await manifest.tables();
      for (const value of Object.values(owned)) {
        if (is(value, PgTable)) found.push(value);
      }
    }
    tables = found;
  }, 60_000);

  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      ])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function person(email: string, name: string) {
    const resolved = (await getService("contacts.resolve").call(
      { email, name, source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  function contactForeignKeys(): string[] {
    const contactsTable = getTableConfig(contacts).name;
    const found = new Set<string>();
    for (const table of tables) {
      const config = getTableConfig(table);
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        if (getTableConfig(reference.foreignTable).name !== contactsTable) continue;
        found.add(config.name);
      }
    }
    return [...found];
  }

  it("upserts a policy for notes and lists it", async () => {
    const saved = await upsertRetentionPolicy.call({ kind: "notes", ttlDays: 30 }, OWNER);
    expect(saved.kind).toBe("notes");
    expect(saved.ttlDays).toBe(30);
    const listed = await listRetentionPolicies.call({}, OWNER);
    expect(listed.kinds.some((row) => row.kind === "notes")).toBe(true);
    expect(listed.policies.some((row) => row.kind === "notes" && row.ttlDays === 30)).toBe(
      true,
    );
  });

  it("refuses an unregistered kind", async () => {
    const refused = await failure(
      upsertRetentionPolicy.call({ kind: "not-a-store", ttlDays: 30 }, OWNER),
    );
    expect(refused.code).toBe("validation");
  });

  it("purges an old note, keeps a recent one, and honours a privacy exception", async () => {
    const keptContact = await person("kept@example.test", "Kept Lane");
    const purgedContact = await person("purged@example.test", "Purged Lane");
    const exceptedContact = await person("hold@example.test", "Hold Lane");
    const recent = await writeNote.call(
      { subjectType: "contact", subjectId: keptContact, body: "Recent note stays." },
      OWNER,
    );
    const old = await writeNote.call(
      { subjectType: "contact", subjectId: purgedContact, body: "Old note goes." },
      OWNER,
    );
    const held = await writeNote.call(
      { subjectType: "contact", subjectId: exceptedContact, body: "Held by exception." },
      OWNER,
    );
    const cutoff = new Date(Date.now() - 40 * DAY_MS);
    await db()
      .update(notes)
      .set({ createdAt: cutoff })
      .where(eq(notes.id, old.id));
    await db()
      .update(notes)
      .set({ createdAt: cutoff })
      .where(eq(notes.id, held.id));

    const request = await createDataRequest.call(
      { contactId: exceptedContact, request: { kind: "erasure" } },
      OWNER,
    );
    await addRetentionException.call(
      {
        dataRequestId: request.id,
        scope: "contact.notes",
        reason: "legal_obligation",
        legalBasis: "Hold these notes for an open claim.",
      },
      OWNER,
    );

    await upsertRetentionPolicy.call({ kind: "notes", ttlDays: 30 }, OWNER);
    const job = listJobs().get("core.applyRetention");
    expect(job).toBeDefined();
    await job!.handler({});

    const remaining = await db()
      .select({ id: notes.id, body: notes.body })
      .from(notes);
    const bodies = remaining.map((row) => row.body);
    expect(bodies).toContain(recent.body);
    expect(bodies).toContain(held.body);
    expect(bodies).not.toContain(old.body);
  });

  it("registers core.applyRetention", async () => {
    const job = listJobs().get("core.applyRetention");
    expect(job).toBeDefined();
    expect(job?.leaseSeconds).toBe(60 * 60);
  });

  it("keeps a conversation with recent activity and only purges finished tasks", async () => {
    const idleContact = await person("idle@example.test", "Idle Lane");
    const liveContact = await person("live@example.test", "Live Lane");
    const idle = await recordMessage.call(
      {
        email: "idle@example.test",
        name: "Idle Lane",
        direction: "inbound",
        channel: "email",
        body: "Old thread, no later activity.",
        subject: "Idle visit",
      },
      OWNER,
    );
    const live = await recordMessage.call(
      {
        email: "live@example.test",
        name: "Live Lane",
        direction: "inbound",
        channel: "email",
        body: "Old thread that will get a new reply.",
        subject: "Live visit",
      },
      OWNER,
    );
    const cutoff = new Date(Date.now() - 40 * DAY_MS);
    const cutoffIso = cutoff.toISOString();
    for (const id of [idle.conversation.id, live.conversation.id]) {
      await db().execute(
        sql`update conversations
            set created_at = ${cutoffIso}::timestamptz,
                updated_at = ${cutoffIso}::timestamptz,
                last_inbound_at = ${cutoffIso}::timestamptz,
                last_outbound_at = ${cutoffIso}::timestamptz
            where id = ${id}`,
      );
    }
    await recordMessage.call(
      {
        conversationId: live.conversation.id,
        contactId: liveContact,
        direction: "inbound",
        channel: "email",
        body: "Yesterday's reply keeps the thread.",
      },
      OWNER,
    );

    const open = await createTask.call(
      { subjectType: "contact", subjectId: idleContact, title: "Still owed" },
      OWNER,
    );
    const finished = await createTask.call(
      { subjectType: "contact", subjectId: idleContact, title: "Already done" },
      OWNER,
    );
    await setTaskStatus.call({ id: finished.id, status: "done" }, OWNER);
    for (const id of [open.id, finished.id]) {
      await db().execute(
        sql`update tasks
            set created_at = ${cutoffIso}::timestamptz,
                updated_at = ${cutoffIso}::timestamptz,
                completed_at = ${cutoffIso}::timestamptz
            where id = ${id}`,
      );
    }

    await upsertRetentionPolicy.call({ kind: "conversations", ttlDays: 30 }, OWNER);
    await upsertRetentionPolicy.call({ kind: "tasks", ttlDays: 30 }, OWNER);
    await listJobs().get("core.applyRetention")!.handler({});

    const remainingThreads = await db()
      .select({ id: conversations.id })
      .from(conversations);
    const threadIds = remainingThreads.map((row) => row.id);
    expect(threadIds).toContain(live.conversation.id);
    expect(threadIds).not.toContain(idle.conversation.id);

    const remainingTasks = await db()
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks);
    const titles = remainingTasks.map((row) => row.title);
    expect(titles).toContain(open.title);
    expect(titles).not.toContain(finished.title);
  });

  it("accounts for every contact foreign key as a purge source or an opt-out", () => {
    const covered = new Set(retentionSources().flatMap((source) => [...source.tables]));
    const missing = contactForeignKeys().filter(
      (table) => !covered.has(table) && !(table in RETENTION_TABLE_OPT_OUTS),
    );
    expect(missing, missing.join(", ")).toEqual([]);

    const stale = Object.keys(RETENTION_TABLE_OPT_OUTS).filter(
      (table) => !contactForeignKeys().includes(table) && !covered.has(table),
    );
    expect(stale, stale.join(", ")).toEqual([]);
    expect(covered.has("notes")).toBe(true);
    expect("consent_records" in RETENTION_TABLE_OPT_OUTS).toBe(true);
  });

  it("does not invent applyRetentionPolicies as a silent no-op without policies", async () => {
    const result = await applyRetentionPolicies();
    expect(result.purged).toEqual({});
  });
});
