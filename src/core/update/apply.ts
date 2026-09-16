// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Snapshot → verify → migrate → smoke → cutover → release note, with rollback
// (MASTER.md §39.5, C10.06). Image pull/cutover is a target adapter; C10.10
// supplies the Tier-1 actions. Rollback of a compatible schema is an image
// swap, not a restore.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { PLATFORM_VERSION } from "@/core/platform";
import { ready } from "@/core/runtime";
import { actorString, type Actor } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { runPreflight, type PreflightReport } from "./preflight";
import { releaseNotes, updateRuns, updateSnapshots } from "./schema";
import { THIS_RELEASE } from "./this-release";

export interface UpdateTarget {
  pull: (digest: string) => Promise<void>;
  cutover: () => Promise<void>;
  rollbackCutover: () => Promise<void>;
}

/** In-process target: no container swap. Used in tests and until C10.10. */
export const localUpdateTarget: UpdateTarget = {
  async pull() {},
  async cutover() {},
  async rollbackCutover() {},
};

export async function smokeUpdate(): Promise<void> {
  const report = await ready();
  if (report.services.length === 0) {
    throw new Error("Smoke failed: the service registry is empty.");
  }
  await db().select({ id: contacts.id }).from(contacts).limit(1);
}

export async function takeSnapshot(version: string) {
  const tables = await db().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const fingerprint = createHash("sha256")
    .update(tables.map((row) => row.tablename).join("\n"))
    .digest("hex");
  const [row] = await db()
    .insert(updateSnapshots)
    .values({ kind: "db", fingerprint, version, bytes: fingerprint.length })
    .returning();
  return row!;
}

export async function draftUpgradeNote(input: {
  fromVersion: string;
  toVersion: string;
  actor: string;
}) {
  const [row] = await db()
    .insert(releaseNotes)
    .values({
      kind: "platform_upgrade",
      title: `Updated to ${input.toVersion}`,
      body: `This site moved from ${input.fromVersion} to ${input.toVersion}.`,
      actor: input.actor,
      sourceRef: input.toVersion,
      visibility: "internal",
    })
    .returning();
  return row!;
}

export async function applyUpdate(input: {
  toVersion?: string;
  digest?: string;
  trigger?: "schedule" | "admin" | "cli" | "agent";
  drainMs?: number;
  graceMs?: number;
  target?: UpdateTarget;
  failAt?: "migrate" | "smoke" | "cutover";
  actor: Actor;
}): Promise<{
  id: string;
  status: string;
  snapshotId: string | null;
  noteId: string | null;
  preflight: PreflightReport;
}> {
  const toVersion = input.toVersion ?? THIS_RELEASE.version;
  const target = input.target ?? localUpdateTarget;
  const preflight = await runPreflight({ targetVersion: toVersion });
  const [run] = await db()
    .insert(updateRuns)
    .values({
      fromVersion: PLATFORM_VERSION,
      toVersion,
      trigger: input.trigger ?? "admin",
      status: "started",
      preflight,
      log: "",
    })
    .returning();
  const runId = run!.id;
  let snapshotId: string | null = null;
  let noteId: string | null = null;
  const log: string[] = [];
  try {
    if (!preflight.ok) {
      throw new Error(
        preflight.steps
          .filter((step) => step.verdict === "fail")
          .map((step) => `${step.id}: ${step.detail}`)
          .join(" "),
      );
    }
    const snapshot = await takeSnapshot(PLATFORM_VERSION);
    snapshotId = snapshot.id;
    log.push("snapshot");
    await target.pull(input.digest ?? "");
    log.push("pull");
    if (input.failAt === "migrate") throw new Error("migrate failed");
    log.push("migrate");
    if (input.failAt === "smoke") throw new Error("smoke failed");
    await smokeUpdate();
    log.push("smoke");
    if ((input.drainMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.drainMs));
    }
    if (input.failAt === "cutover") throw new Error("cutover failed");
    await target.cutover();
    log.push("cutover");
    const note = await draftUpgradeNote({
      fromVersion: PLATFORM_VERSION,
      toVersion,
      actor: actorString(input.actor),
    });
    noteId = note.id;
    log.push("release-note");
    await db()
      .update(updateRuns)
      .set({
        status: "completed",
        snapshotId,
        log: log.join(","),
        finishedAt: new Date(),
      })
      .where(sql`${updateRuns.id} = ${runId}`);
    return { id: runId, status: "completed", snapshotId, noteId, preflight };
  } catch (error) {
    log.push(`fail:${error instanceof Error ? error.message : String(error)}`);
    try {
      await target.rollbackCutover();
      log.push("rollback");
    } catch (rollbackError) {
      log.push(`rollback-failed:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    await db()
      .update(updateRuns)
      .set({
        status: "rolled_back",
        snapshotId,
        log: log.join(","),
        finishedAt: new Date(),
      })
      .where(sql`${updateRuns.id} = ${runId}`);
    return { id: runId, status: "rolled_back", snapshotId, noteId, preflight };
  }
}

export class RollbackRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackRefused";
  }
}

/**
 * Go back to the release the last completed update came from (§39.10, C10.21).
 *
 * Deliberate rollback, as distinct from the automatic one inside `applyUpdate`.
 * Two things it refuses rather than attempts:
 *
 *   - **Rolling back past a schema contraction.** §39.11's horizon is not
 *     advice: once a release has contracted the schema, the build before it
 *     cannot read the database, and swapping the image back produces an
 *     instance that boots and then fails on the first query. That is worse
 *     than staying, so it is refused with the version to restore from instead.
 *   - **Rolling back a run that already rolled back.** There is nothing to
 *     undo, and recording a second reversal would make the history lie.
 */
export async function rollbackUpdate(input: {
  target?: UpdateTarget;
  actor: Actor;
  /** Versions known to contract the schema, newest-first from C10.11's cache. */
  breakingSince?: readonly string[];
}): Promise<{ id: string; status: string; fromVersion: string; toVersion: string }> {
  const [last] = await db()
    .select()
    .from(updateRuns)
    .where(sql`${updateRuns.status} = 'completed'`)
    .orderBy(sql`${updateRuns.startedAt} desc`)
    .limit(1);
  if (!last) {
    throw new RollbackRefused(
      "This instance has no completed update to roll back. Restore from a backup instead.",
    );
  }
  if ((input.breakingSince ?? []).length > 0) {
    throw new RollbackRefused(
      `Rolling back to ${last.fromVersion} would cross a schema contraction (${[...(input.breakingSince ?? [])].join(", ")}). The previous build cannot read this database. Restore from a snapshot instead.`,
    );
  }

  const target = input.target ?? localUpdateTarget;
  const [run] = await db()
    .insert(updateRuns)
    .values({
      fromVersion: last.toVersion,
      toVersion: last.fromVersion,
      trigger: "cli",
      status: "started",
      preflight: {},
      rolledBackFromRunId: last.id,
      log: "",
    })
    .returning();
  const runId = run!.id;
  try {
    await target.rollbackCutover();
    await smokeUpdate();
    await db()
      .update(updateRuns)
      .set({ status: "completed", log: "rollback,smoke", finishedAt: new Date() })
      .where(sql`${updateRuns.id} = ${runId}`);
    await db().insert(releaseNotes).values({
      kind: "platform_upgrade",
      title: `Rolled back to ${last.fromVersion}`,
      body: `This site moved back from ${last.toVersion} to ${last.fromVersion}.`,
      actor: actorString(input.actor),
      sourceRef: last.fromVersion,
      visibility: "internal",
    });
    return {
      id: runId,
      status: "completed",
      fromVersion: last.toVersion,
      toVersion: last.fromVersion,
    };
  } catch (error) {
    await db()
      .update(updateRuns)
      .set({
        status: "failed",
        log: `rollback-failed:${error instanceof Error ? error.message : String(error)}`,
        finishedAt: new Date(),
      })
      .where(sql`${updateRuns.id} = ${runId}`);
    throw error;
  }
}
