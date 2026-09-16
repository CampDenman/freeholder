// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Update preflight (MASTER.md §39.4, C10.05). Honest about what it cannot know.
import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { pluginFitsPlatform } from "@freeholder/plugin-kit";
import { db } from "@/core/db";
import { databaseUrl, env } from "@/core/env";
import { installedPlugins } from "@/core/plugins/schema";
import instanceConfig from "../../../freeholder.config";
import { inspectCoreFiles } from "./integrity";
import { verifyReleaseFeed, type VerifiedRelease } from "./feed";
import { THIS_RELEASE } from "./this-release";

export type PreflightVerdict = "ok" | "warn" | "fail";

export interface PreflightStep {
  id: string;
  verdict: PreflightVerdict;
  detail: string;
}

export interface PreflightReport {
  ok: boolean;
  estimatedDowntimeMs: number;
  steps: PreflightStep[];
}

const SNAPSHOT_BYTES = 256 * 1024 * 1024;

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to quote identifier ${name}`);
  }
  return `"${name}"`;
}

function step(id: string, verdict: PreflightVerdict, detail: string): PreflightStep {
  return { id, verdict, detail };
}

export function pluginCompatibility(
  plugins: { name: string; freeholder: string }[],
  platformVersion: string,
): PreflightStep {
  const broken = plugins.filter((plugin) => !pluginFitsPlatform(plugin.freeholder, platformVersion));
  if (broken.length === 0) {
    return step(
      "plugins",
      "ok",
      plugins.length === 0
        ? "No plugins are installed."
        : `All ${plugins.length} installed plugin${plugins.length === 1 ? "" : "s"} fit ${platformVersion}.`,
    );
  }
  return step(
    "plugins",
    "fail",
    `Cannot apply ${platformVersion}: ${broken.map((plugin) => `${plugin.name} needs ${plugin.freeholder}`).join("; ")}.`,
  );
}

export async function environmentPreflight(): Promise<PreflightStep[]> {
  const steps: PreflightStep[] = [];
  try {
    const disk = await statfs(process.cwd());
    const free = Number(disk.bavail) * Number(disk.bsize);
    steps.push(
      free >= SNAPSHOT_BYTES
        ? step("disk", "ok", `Free disk is enough for a snapshot (${Math.round(free / 1024 / 1024)} MiB).`)
        : step(
            "disk",
            "fail",
            `Free disk is ${Math.round(free / 1024 / 1024)} MiB; a snapshot needs about ${SNAPSHOT_BYTES / 1024 / 1024} MiB.`,
          ),
    );
  } catch (error) {
    steps.push(
      step("disk", "warn", `Could not measure free disk (${error instanceof Error ? error.message : String(error)}).`),
    );
  }

  try {
    const [row] = await db().execute<{ version: string }>(
      sql`select current_setting('server_version') as version`,
    );
    const major = Number.parseInt(row?.version ?? "0", 10);
    steps.push(
      major >= 15
        ? step("postgres", "ok", `Postgres ${row?.version}.`)
        : step("postgres", "fail", `Postgres ${row?.version} is below 15.`),
    );
  } catch (error) {
    steps.push(
      step("postgres", "fail", `Could not read Postgres version (${error instanceof Error ? error.message : String(error)}).`),
    );
  }

  try {
    const rows = await db().execute<{ extname: string }>(sql`select extname from pg_extension`);
    const names = rows.map((row) => row.extname);
    steps.push(
      names.includes("plpgsql")
        ? step("extensions", "ok", `Extensions: ${names.join(", ") || "none"}.`)
        : step("extensions", "fail", "Required extension plpgsql is missing."),
    );
  } catch (error) {
    steps.push(
      step("extensions", "warn", `Could not list extensions (${error instanceof Error ? error.message : String(error)}).`),
    );
  }

  const e = env();
  const storage = e.FREEHOLDER_STORAGE ?? instanceConfig.adapters.storage;
  if (storage === "local" && e.NODE_ENV === "production" && e.FREEHOLDER_UNSAFE_LOCAL_STORAGE !== "1") {
    steps.push(step("adapters", "fail", "Uploads are on local disk in production, which does not survive a rebuild."));
  } else {
    steps.push(step("adapters", "ok", `Storage adapter is ${storage}.`));
  }
  return steps;
}

export async function shadowMigration(extraSql: string[] = []): Promise<{ ok: boolean; ms: number; detail: string }> {
  const schema = `preflight_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const conn = postgres(databaseUrl(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  const started = Date.now();
  try {
    await conn.unsafe(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const tables = await conn<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    for (const { tablename } of tables) {
      await conn.unsafe(
        `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(tablename)} (LIKE public.${quoteIdent(tablename)} INCLUDING DEFAULTS INCLUDING IDENTITY)`,
      );
    }
    await conn.unsafe(`SET search_path TO ${quoteIdent(schema)}`);
    for (const statement of extraSql) {
      await conn.unsafe(statement);
    }
    const ms = Date.now() - started;
    return {
      ok: true,
      ms,
      detail: `Shadow schema cloned ${tables.length} tables in ${ms} ms.`,
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      detail: `Shadow migration failed: ${error instanceof Error ? error.message : String(error)}.`,
    };
  } finally {
    try {
      await conn.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    } catch {
      // The report already carries the dry-run error if the clone failed.
    }
    await conn.end({ timeout: 5 });
  }
}

export async function runPreflight(input: {
  feed?: unknown;
  targetVersion?: string;
  extraSql?: string[];
  root?: string;
}): Promise<PreflightReport> {
  const steps: PreflightStep[] = [];
  let target: Pick<VerifiedRelease, "version" | "pluginApi" | "digest"> = {
    version: THIS_RELEASE.version,
    pluginApi: THIS_RELEASE.pluginApi,
    digest: "",
  };

  if (input.feed !== undefined) {
    try {
      const verified = verifyReleaseFeed(input.feed);
      const latest = verified.releases[0];
      if (!latest) {
        steps.push(step("signature", "fail", "The signed feed contains no releases."));
      } else {
        target = latest;
        steps.push(
          step(
            "signature",
            "ok",
            `Feed signed by ${verified.keyId}. Target ${latest.version} digest ${latest.digest}.`,
          ),
        );
      }
    } catch (error) {
      steps.push(
        step(
          "signature",
          "fail",
          error instanceof Error ? error.message : "The release feed is not signed by a trusted key.",
        ),
      );
    }
  } else {
    steps.push(
      step("signature", "ok", "No feed supplied; preflight is against this build's declared metadata."),
    );
  }

  const plugins = await db()
    .select({ name: installedPlugins.name, freeholder: installedPlugins.freeholder })
    .from(installedPlugins);
  steps.push(pluginCompatibility(plugins, input.targetVersion ?? target.pluginApi));

  const core = await inspectCoreFiles({
    root: input.root ?? process.cwd(),
    expectedDigest: env().FREEHOLDER_CORE_DIGEST ?? (target.digest || null),
    hash: Boolean(env().FREEHOLDER_CORE_DIGEST || target.digest),
  });
  if (core.matches === false) {
    steps.push(
      step(
        "drift",
        "fail",
        "Replaceable core does not match the release digest. This instance is a fork; updates will not overwrite owner code.",
      ),
    );
  } else if (core.modified.length > 0) {
    steps.push(
      step(
        "drift",
        "warn",
        `${core.modified.length} core file${core.modified.length === 1 ? " was" : "s were"} edited. The fork lane is the supported path.`,
      ),
    );
  } else {
    steps.push(step("drift", "ok", "No unsupported live core-file edits detected."));
  }

  steps.push(...(await environmentPreflight()));

  const shadow = await shadowMigration(input.extraSql ?? []);
  steps.push(step("migrations", shadow.ok ? "ok" : "fail", shadow.detail));
  steps.push(
    step(
      "downtime",
      shadow.ok ? "ok" : "fail",
      shadow.ok
        ? `Estimated downtime from the dry run is ${shadow.ms} ms.`
        : "Downtime cannot be estimated because the shadow migration failed.",
    ),
  );

  return {
    ok: steps.every((item) => item.verdict !== "fail"),
    estimatedDowntimeMs: shadow.ok ? shadow.ms : 0,
    steps,
  };
}
