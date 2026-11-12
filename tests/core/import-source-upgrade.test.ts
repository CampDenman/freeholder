// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47/C11.08: populated N-1 imports stay unchanged; old graph writers refuse.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const migration = readFileSync("db/migrations/0073_import_source_graph.sql", "utf8");
describe.runIf(hasDatabase)("populated source graph upgrade (C3.47)", () => {
  beforeEach(truncateSpine); afterAll(closeDb);
  it("preserves ordinary previews and source manifests without inventing graphs, then fences both old root and child writers", async () => {
    const rollback = new Error("Rollback the isolated populated schema72 fixture");
    await expect(db().transaction(async tx => {
      await tx.execute(sql.raw("drop function freeholder_guard_import_graph_writer() cascade; drop function freeholder_guard_import_graph_identity() cascade; drop function freeholder_guard_import_entry_identity() cascade; drop function freeholder_guard_import_media_identity() cascade; drop table import_source_media,import_source_batches,import_source_entries,import_source_graphs;"));
      const root = randomUUID(), ordinary = randomUUID(), child = randomUUID(), graph = randomUUID();
      const preview = { pages: [{ slug: "original-owner-preview", title: "Original source title", blocks: [{ type: "text", text: "Unchanged original source body" }] }] };
      const checkpoint = { retainedSource: { runId: root, uploadId: randomUUID(), revision: "b".repeat(64), filename: "fictional-original.xml", bytes: 4, chunkBytes: 4194304, chunkDigests: ["c".repeat(64)], expiresAt: "2099-01-01T00:00:00.000Z" } };
      await tx.execute(sql`insert into import_runs(id,source,kind,status,preview,checkpoint,counts,created_by) values(${root},'wordpress-wxr:https://fictional-upgrade.example','wordpress-wxr','previewed',${JSON.stringify(preview)}::jsonb,${JSON.stringify(checkpoint)}::jsonb,'{"pages":1}'::jsonb,'system'),(${ordinary},'html:https://fictional-ordinary.example','html','previewed','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'system')`);
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
      expect(await tx.execute(sql`select preview,checkpoint,counts from import_runs where id=${root}`)).toEqual([{ preview, checkpoint, counts: { pages: 1 } }]);
      for (const table of ["import_source_graphs", "import_source_entries", "import_source_batches", "import_source_media"]) expect(await tx.execute(sql.raw(`select 1 from ${table}`))).toHaveLength(0);
      // Existing finite imports remain compatible; only the new graph's
      // root/private children require the original guarded writer capability.
      await tx.execute(sql`update import_runs set status='committed' where id=${ordinary}`);
      await tx.execute(sql`insert into import_source_graphs(id,run_id,generation,source_revision,source_started_at,cursor) values(${graph},${root},${randomUUID()},${"a".repeat(64)},clock_timestamp(),'{"ordinal":0}'::jsonb)`);
      await tx.execute(sql`insert into import_runs(id,source,kind,status,created_by) values(${child},'wordpress-wxr:https://fictional-upgrade.example','wordpress-wxr','discover','system')`);
      await tx.execute(sql`insert into import_source_batches(graph_id,batch_index,child_run_id,start_ordinal,end_ordinal) values(${graph},0,${child},0,1)`);
      await expect(tx.transaction(inner => inner.execute(sql`update import_runs set status='committed' where id=${root}`))).rejects.toMatchObject({ cause: { code: "55000", message: "This import requires the guarded source graph writer" } });
      await expect(tx.transaction(inner => inner.execute(sql`delete from import_runs where id=${child}`))).rejects.toMatchObject({ cause: { code: "55000", message: "This import requires the guarded source graph writer" } });
      await tx.execute(sql`select set_config('freeholder.import_graph_writer','v1',true)`);
      await tx.execute(sql`update import_runs set status='committed' where id=${root}`);
      expect(await tx.execute(sql`select preview,checkpoint from import_runs where id=${root}`)).toEqual([{ preview, checkpoint }]);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
