// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.19: prove the reviewed baseline matches the pre-collapse chain.
//
// MASTER requires a fresh baseline apply to be structurally identical to a
// fresh chain apply. After the collapse the chain is gone from HEAD; it still
// lives at the parent of the commit that deleted `0000_core-spine.sql`, and a
// normalized catalog dump of that apply is checked in as
// `tests/fixtures/c1019-chain.catalog` so a shallow clone can still fail CI.
//
// Constraint and index *names* are ignored: drizzle emits `*_id_*_id_fk`
// where hand-written SQL used Postgres `*_fkey`. Definitions must match.
//
// Usage: node scripts/schema-baseline-identity.mjs [--write-fixture]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const FIXTURE = "tests/fixtures/c1019-chain.catalog";
export const BASELINE_FOLDER = "db/migrations";
export const CHAIN_MARKER = "db/migrations/0000_core-spine.sql";

const CATALOG_SQL = `
SELECT kind, a, b, c FROM (
  SELECT 'ext'::text AS kind, extname AS a, ''::text AS b, ''::text AS c
  FROM pg_extension WHERE extname <> 'plpgsql'
  UNION ALL
  SELECT 'col', c.relname, a.attname,
    format('%s|%s|%s',
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END,
      coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''))
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'con', c.relname, con.conname,
    regexp_replace(pg_get_constraintdef(con.oid), E'\\\\s+', ' ', 'g')
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'idx', tablename, indexname, regexp_replace(indexdef, E'\\\\s+', ' ', 'g')
  FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'fn', p.proname, '', regexp_replace(pg_get_functiondef(p.oid), E'\\\\s+', ' ', 'g')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'trg', c.relname, t.tgname, regexp_replace(pg_get_triggerdef(t.oid), E'\\\\s+', ' ', 'g')
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
) q
ORDER BY 1, 2, 3, 4
`;

/** One catalog row as TSV. */
export function formatCatalogRow(row) {
  return [row.kind, row.a, row.b, row.c].join("\t");
}

/**
 * Drop constraint/index names that drizzle and hand-written SQL disagree on.
 * Definitions stay; a renamed FK with a different ON DELETE still fails.
 */
export function normalizeCatalogLine(line) {
  const parts = line.split("\t");
  const kind = parts[0];
  if (kind === "con") {
    return ["condef", parts[1] ?? "", parts[3] ?? ""].join("\t");
  }
  if (kind === "idx") {
    const def = (parts[3] ?? "")
      .replace(/CREATE UNIQUE INDEX \S+ ON/, "CREATE UNIQUE INDEX <n> ON")
      .replace(/CREATE INDEX \S+ ON/, "CREATE INDEX <n> ON");
    return ["idxdef", parts[1] ?? "", def].join("\t");
  }
  return line;
}

export function catalogSet(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .filter((line) => !line.startsWith("#"))
      .map(normalizeCatalogLine),
  );
}

export function diffCatalogs(chainText, baselineText) {
  const chain = catalogSet(chainText);
  const baseline = catalogSet(baselineText);
  const onlyChain = [...chain].filter((line) => !baseline.has(line)).sort();
  const onlyBaseline = [...baseline].filter((line) => !chain.has(line)).sort();
  return { onlyChain, onlyBaseline, ok: onlyChain.length === 0 && onlyBaseline.length === 0 };
}

/** The commit that still has 0000_core-spine.sql, or null when git cannot see it. */
export function resolveChainRef(env = process.env) {
  if (env.C10_19_CHAIN_REF) return env.C10_19_CHAIN_REF;
  try {
    const deleted = execFileSync(
      "git",
      ["log", "--diff-filter=D", "-1", "--format=%H", "--", CHAIN_MARKER],
      { encoding: "utf8" },
    ).trim();
    if (!deleted) return null;
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${deleted}^`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return `${deleted}^`;
  } catch {
    return null;
  }
}

function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function databaseUrl(source, database) {
  const result = new URL(source);
  result.pathname = `/${encodeURIComponent(database)}`;
  return result.toString();
}

function adminUrl(source) {
  return databaseUrl(source, "postgres");
}

function scratchName(sourceDb, role) {
  const base = sourceDb.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
  return `${base}_c1019_${role}`;
}

function guardedSourceUrl(value) {
  if (!value) {
    throw new Error("Set TEST_DATABASE_URL or DATABASE_URL to a disposable database.");
  }
  const name = databaseName(value);
  if (!name || !/(?:test|drill)/i.test(name)) {
    throw new Error(
      `C10.19 identity refused database "${name || "(missing)"}"; its name must contain test or drill.`,
    );
  }
  return value;
}

async function dumpCatalog(url) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await client.unsafe(CATALOG_SQL);
    return rows.map(formatCatalogRow).join("\n") + "\n";
  } finally {
    await client.end();
  }
}

async function applyMigrations(url, folder) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}

async function recreateDatabase(admin, name) {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
}

function extractChain(ref, dest) {
  const archive = execFileSync("git", ["archive", ref, "db/migrations"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dest], { input: archive });
}

export async function proveBaselineIdentity(options = {}) {
  const url = guardedSourceUrl(
    options.url ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  );
  const repoRoot = options.repoRoot ?? process.cwd();
  const sourceDb = databaseName(url);
  const chainName = scratchName(sourceDb, "chain");
  const baselineName = scratchName(sourceDb, "baseline");
  const admin = postgres(adminUrl(url), { max: 1, onnotice: () => {} });
  const created = [];
  let tmp;
  try {
    await recreateDatabase(admin, baselineName);
    created.push(baselineName);
    await applyMigrations(databaseUrl(url, baselineName), join(repoRoot, BASELINE_FOLDER));
    const baselineCatalog = await dumpCatalog(databaseUrl(url, baselineName));

    const fixturePath = join(repoRoot, FIXTURE);
    let fixtureCatalog = null;
    try {
      fixtureCatalog = readFileSync(fixturePath, "utf8");
    } catch {
      fixtureCatalog = null;
    }

    const vsFixture = fixtureCatalog
      ? diffCatalogs(fixtureCatalog, baselineCatalog)
      : null;

    const chainRef = resolveChainRef(options.env ?? process.env);
    let vsChain = null;
    let skippedChainReason = null;
    if (!chainRef) {
      skippedChainReason =
        "git cannot see the pre-collapse chain (shallow clone). Comparing the baseline apply against tests/fixtures/c1019-chain.catalog instead. The chain lives at the parent of the commit that deleted db/migrations/0000_core-spine.sql; set C10_19_CHAIN_REF to apply it.";
    } else {
      tmp = mkdtempSync(join(tmpdir(), "fh-c1019-chain-"));
      try {
        extractChain(chainRef, tmp);
        await recreateDatabase(admin, chainName);
        created.push(chainName);
        await applyMigrations(databaseUrl(url, chainName), join(tmp, BASELINE_FOLDER));
        const chainCatalog = await dumpCatalog(databaseUrl(url, chainName));
        vsChain = diffCatalogs(chainCatalog, baselineCatalog);
        if (options.writeFixture) {
          writeFileSync(
            fixturePath,
            `# Pre-collapse chain catalog (C10.19). Regenerated from ${chainRef}.\n` +
              `# Constraint/index names are compared after normalizeCatalogLine.\n` +
              chainCatalog,
          );
        }
      } catch (error) {
        skippedChainReason = `chain apply from ${chainRef} failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }

    if (!vsFixture && !vsChain) {
      throw new Error(
        "C10.19 identity: no chain apply and no fixture catalog. Commit tests/fixtures/c1019-chain.catalog or set C10_19_CHAIN_REF.",
      );
    }

    const failures = [];
    if (vsFixture && !vsFixture.ok) {
      failures.push(
        `baseline apply differs from ${FIXTURE}: ` +
          `${vsFixture.onlyChain.length} only in chain fixture, ` +
          `${vsFixture.onlyBaseline.length} only in baseline`,
      );
    }
    if (vsChain && !vsChain.ok) {
      failures.push(
        `baseline apply differs from chain apply (${chainRef}): ` +
          `${vsChain.onlyChain.length} only in chain, ` +
          `${vsChain.onlyBaseline.length} only in baseline`,
      );
    }

    return {
      ok: failures.length === 0,
      failures,
      chainRef,
      skippedChainReason,
      vsFixture,
      vsChain,
      baselineLines: baselineCatalog.split("\n").filter(Boolean).length,
    };
  } finally {
    try {
      for (const name of created) {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end().catch(() => undefined);
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  }
}

async function main() {
  const writeFixture = process.argv.includes("--write-fixture");
  const result = await proveBaselineIdentity({ writeFixture });
  if (result.skippedChainReason) {
    console.warn(`C10.19 identity: ${result.skippedChainReason}`);
  }
  if (result.chainRef && result.vsChain) {
    console.log(
      `C10.19 identity: chain ${result.chainRef} vs baseline: ` +
        (result.vsChain.ok
          ? `identical (${result.baselineLines} catalog rows, names normalized).`
          : `DIVERGED only-chain=${result.vsChain.onlyChain.length} only-baseline=${result.vsChain.onlyBaseline.length}`),
    );
    if (!result.vsChain.ok) {
      for (const line of result.vsChain.onlyChain.slice(0, 20)) console.error(`  chain  ${line}`);
      for (const line of result.vsChain.onlyBaseline.slice(0, 20)) console.error(`  base   ${line}`);
    }
  }
  if (result.vsFixture) {
    console.log(
      `C10.19 identity: fixture ${FIXTURE} vs baseline: ` +
        (result.vsFixture.ok
          ? "identical (names normalized)."
          : `DIVERGED only-fixture=${result.vsFixture.onlyChain.length} only-baseline=${result.vsFixture.onlyBaseline.length}`),
    );
    if (!result.vsFixture.ok) {
      for (const line of result.vsFixture.onlyChain.slice(0, 20)) console.error(`  fixture ${line}`);
      for (const line of result.vsFixture.onlyBaseline.slice(0, 20)) console.error(`  base    ${line}`);
    }
  }
  if (!result.ok) {
    console.error(result.failures.join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
