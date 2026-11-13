// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: compare the source models against actual separately migrated SQL.
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { closeDb, db } from "@/core/db";
import { importCrawlRequests, importCrawlResponseErasures, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { importCrawlEntryOriginals, importCrawlGraphs } from "@/core/import/crawl-graph-schema";
import { importCrawlErasureScopes, importCrawlErasureSources } from "@/core/import/crawl-erasure-schema";
import { importSourceMedia } from "@/core/plugins/schema";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const tables = [importCrawlSources, importCrawlRequests, importCrawlResponses, importCrawlResponseErasures, importCrawlGraphs, importCrawlEntryOriginals, importCrawlErasureScopes, importCrawlErasureSources, importSourceMedia];
describe.runIf(hasDatabase)("actual crawl source SQL/model columns (C3.47)", () => {
  afterAll(closeDb);
  for (const table of tables) {
    const config = getTableConfig(table);
    it(`matches the actual ${config.name} types, nullability and defaults`, async () => {
      const actual = await db().execute<{ name: string; type: string; nullable: boolean; defaulted: boolean }>(sql`
        select column_name as name,data_type as type,is_nullable='YES' as nullable,column_default is not null as defaulted
        from information_schema.columns where table_schema='public' and table_name=${config.name} order by column_name
      `);
      expect([...actual]).toEqual(config.columns.map(column => ({ name: column.name, type: column.getSQLType(), nullable: !column.notNull, defaulted: column.hasDefault })).sort((left, right) => left.name.localeCompare(right.name)));
    });
  }
});
