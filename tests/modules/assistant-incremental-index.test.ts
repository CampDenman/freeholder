// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47/C9.22: a large import must not rebuild every public page per event.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { assistantChunks } from "@/modules/assistant/schema";
import { createPage, deleteDraftPage, publishPage } from "@/modules/cms/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("incremental public page indexing (C3.47/C9.22)", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);
  const page = (slug: string) => createPage.call({ slug, title: `Public ${slug}`, blocks: [{ id: "heading", type: "heading", props: { text: `Public ${slug}`, level: 1 } }] }, OWNER);
  it("publishes one new page without rewriting an unrelated indexed page", async () => {
    const first = await page("existing-index"), second = await page("new-index");
    await publishPage.call({ id: first.id, published: true }, OWNER);
    const prior = new Date("2000-01-01T00:00:00Z");
    await db().update(assistantChunks).set({ updatedAt: prior }).where(eq(assistantChunks.sourceId, first.id));
    await publishPage.call({ id: second.id, published: true }, OWNER);
    const found = await db().select().from(assistantChunks);
    expect(found.find(chunk => chunk.sourceId === second.id)?.body).toContain("Public new-index");
    expect(found.find(chunk => chunk.sourceId === first.id)?.updatedAt).toEqual(prior);
  });
  it("removes unpublished/deleted page chunks without touching the rest of the corpus", async () => {
    const first = await page("retained-index"), second = await page("removed-index");
    await publishPage.call({ id: first.id, published: true }, OWNER);
    await publishPage.call({ id: second.id, published: true }, OWNER);
    const prior = new Date("2000-01-01T00:00:00Z");
    await db().update(assistantChunks).set({ updatedAt: prior }).where(eq(assistantChunks.sourceId, first.id));
    await publishPage.call({ id: second.id, published: false }, OWNER);
    await deleteDraftPage.call({ id: second.id }, OWNER);
    const found = await db().select().from(assistantChunks);
    expect(found.some(chunk => chunk.sourceId === second.id)).toBe(false);
    expect(found.find(chunk => chunk.sourceId === first.id)?.updatedAt).toEqual(prior);
  });
});
