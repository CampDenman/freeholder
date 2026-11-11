// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: opt-in actual N-1 HTTP writer proof against the migrated test database.
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { importRuns, importSourceBatches, importSourceGraphs } from "@/core/plugins/schema";
import { pages } from "@/modules/cms/schema";
import { previewFromSource, startImport } from "@/core/import/service";
import { OWNER } from "../helpers/spine";

afterAll(closeDb);
it("keeps ordinary imports working while an actual older application refuses graph root and child writes", async () => {
  const address = process.env.FREEHOLDER_OLD_IMPORT_IMAGE_URL;
  const database = process.env.DATABASE_URL;
  if (!address || !database || !/test/i.test(new URL(database).pathname) || !["127.0.0.1", "localhost"].includes(new URL(address).hostname)) throw new Error("Supply a local N-1 application and an explicitly disposable migrated database with the browser owner fixture.");
  const token = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const csrf = issueCsrfToken();
  const headers = { "content-type": "application/json", origin: address, [CSRF_HEADER]: csrf, cookie: `${SESSION_COOKIE}=${token.token}; ${CSRF_COOKIE}=${csrf}` };
  const invoke = (operation: string, id: string) => fetch(`${address}/api/v1/imports.${operation}`, { method: "POST", headers, body: JSON.stringify({ id }) });
  const prepare = async (slug: string) => {
    const run = await startImport.call({ kind: "wordpress-wxr", origin: "https://fictional-old-image.example" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: `<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><link>https://fictional-old-image.example</link><item><title>Fictional previous-image page</title><link>https://fictional-old-image.example/${slug}</link><wp:post_id>1</wp:post_id><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Previous-image fixture.</p>]]></content:encoded></item></channel></rss>` }, OWNER);
    return run.id;
  };
  const ordinary = await prepare("old-image-ordinary");
  const accepted = await invoke("commit", ordinary);
  expect(accepted.ok, await accepted.text()).toBe(true);
  expect((await db().select().from(importRuns).where(eq(importRuns.id, ordinary)))[0]?.status).toBe("committed");
  const root = await prepare("old-image-root"), child = await prepare("old-image-child"), graph = randomUUID();
  await db().insert(importSourceGraphs).values({ id: graph, runId: root, generation: randomUUID(), sourceRevision: "a".repeat(64), sourceStartedAt: new Date(), cursor: { ordinal: 0 } });
  await db().insert(importSourceBatches).values({ graphId: graph, batchIndex: 0, childRunId: child, startOrdinal: 0, endOrdinal: 1 });
  const originalPages = await db().select().from(pages).orderBy(pages.id);
  for (const id of [root, child]) for (const operation of ["commit", "rollback"]) {
    const refused = await invoke(operation, id);
    expect(refused.ok, `${operation} must refuse the original graph writer`).toBe(false);
    expect((await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("previewed");
    expect(await db().select().from(pages).orderBy(pages.id)).toEqual(originalPages);
  }
}, 60_000);
