// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Disposable pg_dump/pg_restore and ownership-export rehearsal (C1.23).
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  createOwnershipExport,
  databaseFingerprint,
} from "./ownership-export.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function guardedDrillUrl(value) {
  if (!value) {
    throw new Error(
      "Set OWNERSHIP_DRILL_DATABASE_URL or TEST_DATABASE_URL to a disposable database.",
    );
  }
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database || !/(?:test|drill)/i.test(database)) {
    throw new Error(
      `Ownership drill refused database "${database || "(missing)"}"; its name must contain test or drill.`,
    );
  }
  return { url: parsed, database };
}

function databaseUrl(source, database) {
  const result = new URL(source);
  result.pathname = `/${encodeURIComponent(database)}`;
  return result.toString();
}

async function command(executable, args, { quiet = false } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
      windowsHide: true,
    });
    let error = "";
    if (quiet) {
      child.stderr?.on("data", (chunk) => {
        if (error.length < 4_000) error += chunk.toString();
      });
    }
    child.once("error", (cause) => {
      reject(
        new Error(
          `Could not run ${executable}. Install the PostgreSQL client matching the server version.`,
          { cause },
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${executable} failed (${signal ?? code})${error ? `: ${error.trim()}` : ""}`,
          ),
        );
      }
    });
  });
}

async function terminateAndDrop(admin, database) {
  await admin`
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = ${database} and pid <> pg_backend_pid()
  `;
  await admin.unsafe(`drop database if exists "${database}"`);
}

function compareFingerprints(source, restored) {
  if (JSON.stringify(source) !== JSON.stringify(restored)) {
    const sourceMap = new Map(
      source.map((item) => [`${item.schema}.${item.table}`, item]),
    );
    const restoredMap = new Map(
      restored.map((item) => [`${item.schema}.${item.table}`, item]),
    );
    const names = [...new Set([...sourceMap.keys(), ...restoredMap.keys()])].sort();
    const differences = names.filter(
      (name) => JSON.stringify(sourceMap.get(name)) !== JSON.stringify(restoredMap.get(name)),
    );
    throw new Error(
      `Restored database differs from source in: ${differences.join(", ") || "inventory order"}`,
    );
  }
}

export async function runOwnershipDrill({
  sourceDatabaseUrl,
  configPath = path.resolve("freeholder.config.ts"),
  environment = process.env,
}) {
  const guarded = guardedDrillUrl(sourceDatabaseUrl);
  // The restore is on the same server, not merely the same hostname. Libpq
  // permits query parameters to override routing, so reject the ones that
  // could make the scratch database land somewhere different from the source.
  for (const parameter of ["host", "hostaddr", "port", "service", "dbname"]) {
    if (guarded.url.searchParams.has(parameter)) {
      throw new Error(
        `Ownership drill refused DATABASE_URL query parameter "${parameter}"; use URL host/path fields so source, admin and restore stay on one server.`,
      );
    }
  }
  const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
  const safeSourceName = guarded.database.replace(/[^a-zA-Z0-9_]/g, "_");
  const restoredName = `${safeSourceName}_restore_${suffix}`.slice(0, 63);
  if (!/^[a-zA-Z0-9_]+$/.test(restoredName)) {
    throw new Error("The generated restore database name was not a safe identifier.");
  }
  const restoredUrl = databaseUrl(guarded.url, restoredName);
  const adminUrl = databaseUrl(guarded.url, "postgres");
  const temporary = await mkdtemp(path.join(tmpdir(), "freeholder-ownership-drill-"));
  const dump = path.join(temporary, "database.dump");
  const exportDirectory = path.join(temporary, "logical-export");
  const admin = postgres(adminUrl, { max: 1, prepare: false });

  try {
    await terminateAndDrop(admin, restoredName);
    await admin.unsafe(`create database "${restoredName}"`);

    await command("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      dump,
      guarded.url.toString(),
    ]);
    await command("pg_restore", [
      "--no-owner",
      "--no-privileges",
      "--dbname",
      restoredUrl,
      dump,
    ]);

    const [sourceFingerprint, restoredFingerprint] = await Promise.all([
      databaseFingerprint(guarded.url.toString()),
      databaseFingerprint(restoredUrl),
    ]);
    compareFingerprints(sourceFingerprint, restoredFingerprint);

    const exported = await createOwnershipExport({
      databaseUrl: restoredUrl,
      outputDirectory: exportDirectory,
      configPath,
      environment,
    });
    if (exported.manifest.tableCount !== restoredFingerprint.length) {
      throw new Error(
        `Logical export covered ${exported.manifest.tableCount} of ${restoredFingerprint.length} restored tables.`,
      );
    }
    return {
      tables: restoredFingerprint.length,
      rows: restoredFingerprint.reduce((sum, item) => sum + item.rows, 0),
      assets: exported.manifest.media.assetCount,
      objects: exported.manifest.media.objectCount,
    };
  } finally {
    try {
      await terminateAndDrop(admin, restoredName);
    } finally {
      await admin.end().catch(() => undefined);
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

async function main() {
  const sourceDatabaseUrl = argument(
    "database-url",
    process.env.OWNERSHIP_DRILL_DATABASE_URL ??
      process.env.TEST_DATABASE_URL ??
      (process.env.CI ? process.env.DATABASE_URL : undefined),
  );
  const result = await runOwnershipDrill({ sourceDatabaseUrl });
  console.log(
    `ownership drill: pg_dump/restore and secret-safe export matched ${result.tables} tables, ${result.rows} rows, ${result.assets} assets and ${result.objects} media objects`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
