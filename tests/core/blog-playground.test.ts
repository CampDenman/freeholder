// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { validateSession } from "@/core/auth/sessions";
import { resetEnvForTests } from "@/core/env";
import { enterPlayground, initializePlayground, markPlaygroundBaseline } from "@/core/demo/playground";
import { createRole } from "@/core/roles/service";
import { publishPage } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { blogAuthors, blogTerms } from "@/modules/cms/blog-schema";
import { createPost, saveAuthor, saveTerm, deleteAuthor, deleteTerm, setPostMeta, postMetaAt, updateBlogSettings } from "@/modules/cms/blog-service";
import { listReaderComments, moderateReaderComment, submitReaderComment } from "@/modules/cms/blog-comments";
import { ANONYMOUS, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const browser = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "freeholder_session" && browser.token ? { value: browser.token } : undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const { createBlogPostAction } = await import("../../app/(admin)/admin/blog/actions");

describe.runIf(hasDatabase)("editable blog in the disposable playground", () => {
  beforeEach(async () => {
    await truncateSpine();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
    await initializePlayground();
    await markPlaygroundBaseline();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
  afterAll(closeDb);

  async function visitor() {
    const issued = await enterPlayground.call({}, ANONYMOUS);
    browser.token = issued.token;
    const session = await db().transaction(tx => validateSession(tx, issued.token));
    if (!session) throw new Error("No playground session");
    return { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants };
  }

  it("lets the actual visitor create, publish and moderate a blog without gaining authority", async () => {
    const actor = await visitor();
    const author = await saveAuthor.call({ name: "Demo writer", email: "writer@example.test" }, actor);
    const category = await saveTerm.call({ taxonomy: "category", name: "Demo category" }, actor);
    const tag = await saveTerm.call({ taxonomy: "tag", name: "Demo tag" }, actor);
    const form = new FormData();
    form.set("title", "Demo post"); form.set("slug", "demo-post");
    await expect(createBlogPostAction(form)).rejects.toMatchObject({ url: expect.stringMatching(/^\/admin\/pages\/[0-9a-f-]+$/) });
    const [post] = await db().select().from(pages).where(eq(pages.slug, "blog/demo-post"));
    if (!post) throw new Error("Blog action did not create its draft");
    await setPostMeta.call({ pageId: post.id, isPost: true, authorId: author.id, categoryIds: [category.id], tagIds: [tag.id] }, actor);
    await saveAuthor.call({ id: author.id, name: "Updated demo writer" }, actor);
    await saveTerm.call({ id: category.id, taxonomy: "category", name: "Updated category" }, actor);
    await updateBlogSettings.call({ postsPerPage: 8, commentsEnabled: true }, actor);
    await publishPage.call({ id: post.id, published: true }, actor);
    const metadata = await postMetaAt.call({ slug: "blog/demo-post" }, ANONYMOUS);
    expect(metadata?.author?.name).toBe("Updated demo writer");
    expect(JSON.stringify(metadata)).not.toContain("writer@example.test");
    const comment = await submitReaderComment.call({ pageId: post.id, name: "Demo reader", email: "reader@example.test", body: "An ordinary comment" }, ANONYMOUS);
    expect(await listReaderComments.call({ pageId: post.id }, ANONYMOUS)).toEqual([]);
    await moderateReaderComment.call({ id: comment.id, status: "approved" }, actor);
    const visible = await listReaderComments.call({ pageId: post.id }, ANONYMOUS);
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain("reader@example.test");
    await deleteTerm.call({ id: tag.id }, actor);
    await deleteAuthor.call({ id: author.id }, actor);
    await expect(createRole.call({ name: "Escalation", grants: [{ module: "*", access: "manage" }] }, actor)).rejects.toMatchObject({ code: "permission" });
  });

  it("bounds blog rows and rolls an over-budget inline tag batch back atomically", async () => {
    const actor = await visitor();
    const post = await createPost.call({ title: "Bounded post", slug: "bounded" }, actor);
    await db().insert(pages).values(Array.from({ length: 49 }, (_, i) => ({ slug: `filler-${i}`, title: `Filler ${i}` })));
    await db().insert(blogAuthors).values(Array.from({ length: 50 }, (_, i) => ({ slug: `writer-${i}`, path: `author/writer-${i}`, name: `Writer ${i}` })));
    await db().insert(blogTerms).values(Array.from({ length: 99 }, (_, i) => ({ taxonomy: "tag" as const, slug: `tag-${i}`, path: `tag/tag-${i}`, name: `Tag ${i}` })));
    await expect(createPost.call({ title: "Over budget", slug: "overflow" }, actor)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(saveAuthor.call({ name: "Over budget" }, actor)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(setPostMeta.call({ pageId: post.id, tagNames: ["First new", "Second new"] }, actor)).rejects.toMatchObject({ code: "rate_limited" });
    expect((await db().select({ total: count() }).from(blogTerms))[0]?.total).toBe(99);
    await setPostMeta.call({ pageId: post.id, tagNames: ["Exactly one"] }, actor);
    expect((await db().select({ total: count() }).from(blogTerms))[0]?.total).toBe(100);
    await expect(saveTerm.call({ taxonomy: "category", name: "Over budget" }, actor)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(setPostMeta.call({ pageId: post.id, tagNames: ["Another new"] }, actor)).rejects.toMatchObject({ code: "rate_limited" });
    expect((await db().select({ total: count() }).from(pages))[0]?.total).toBe(50);
  });

  it("lets only one concurrent creator take the last taxonomy slot", async () => {
    const actor = await visitor();
    await db().insert(blogTerms).values(Array.from({ length: 99 }, (_, i) => ({ taxonomy: "tag" as const, slug: `tag-${i}`, path: `tag/tag-${i}`, name: `Tag ${i}` })));
    const outcomes = await Promise.allSettled([
      saveTerm.call({ taxonomy: "tag", name: "Concurrent one" }, actor),
      saveTerm.call({ taxonomy: "tag", name: "Concurrent two" }, actor),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "rate_limited" } });
    expect((await db().select({ total: count() }).from(blogTerms))[0]?.total).toBe(100);
  });
});
