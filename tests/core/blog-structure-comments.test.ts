// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { contactPrivacySources } from "@/core/privacy/service";
import { notifications } from "@/core/notifications/schema";
import { registerPublishVeto } from "@/core/privacy/publish-veto";
import { resolveRedirect } from "@/core/seo/service";
import { createPage, publishPage, updatePage } from "@/modules/cms/service";
import { saveAuthor, saveTerm, setPostMeta, postMetaAt, resolveBlogArchive, updateBlogSettings, publicBlogCategories } from "@/modules/cms/blog-service";
import { listBlogPosts } from "@/modules/cms/blog";
import { blogReaderComments as comments } from "@/modules/cms/blog-comments-schema";
import { submitReaderComment, listReaderComments, moderateReaderComment, listReaderCommentsForOwner } from "@/modules/cms/blog-comments";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

async function post(slug = "2025/03/original-address") {
  const page = await createPage.call({ title: "A post", slug, blocks: [{ id: "heading", type: "heading", props: { text: "A post", level: 1 } }] }, OWNER);
  await setPostMeta.call({ pageId: page.id, isPost: true }, OWNER);
  await publishPage.call({ id: page.id, published: true }, OWNER);
  return page;
}

describe.runIf(hasDatabase)("blog structure and moderated reader comments", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
  });
  afterAll(closeDb);

  it("keeps arbitrary post permalinks, category descendants and private author details out of public output", async () => {
    const page = await post();
    const author = await saveAuthor.call({ name: "Reader Writer", email: "private@example.test", bio: "An author" }, OWNER);
    const parent = await saveTerm.call({ taxonomy: "category", name: "Parent" }, OWNER);
    const child = await saveTerm.call({ taxonomy: "category", name: "Child", parentId: parent.id }, OWNER);
    await setPostMeta.call({ pageId: page.id, isPost: true, authorId: author.id, categoryIds: [child.id], tagNames: ["One", "One"] }, OWNER);
    const meta = await postMetaAt.call({ slug: page.slug }, ANONYMOUS);
    expect(meta?.author).toEqual({ name: "Reader Writer", path: author.path, bio: "An author" });
    expect(JSON.stringify(meta)).not.toContain("private@example.test");
    const listing = await listBlogPosts.call({ category: parent.slug }, ANONYMOUS);
    expect(listing.posts.map(entry => entry.slug)).toEqual([page.slug]);
    expect(await resolveBlogArchive.call({ path: parent.path }, ANONYMOUS)).toMatchObject({ posts: 1 });
    const moved = await saveTerm.call({ id: parent.id, taxonomy: "category", name: "Renamed", slug: "renamed" }, OWNER);
    expect(await resolveRedirect.call({ path: child.path }, ANONYMOUS)).toEqual({ toPath: `${moved.path}/child`, status: "301" });
    await expect(saveTerm.call({ id: parent.id, taxonomy: "category", name: "Bad", parentId: child.id }, OWNER)).rejects.toMatchObject({ code: "validation" });
  });

  it("holds new comments, sends one owner notification, publishes escaped plain text only after approval, and supports replies", async () => {
    const page = await post();
    const submitted = await submitReaderComment.call({ pageId: page.id, name: "Public name", email: "private@example.test", body: "<script>plain text</script>" }, ANONYMOUS);
    expect(await listReaderComments.call({ pageId: page.id }, ANONYMOUS)).toEqual([]);
    const queue = await listReaderCommentsForOwner.call({}, OWNER);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: submitted.id, status: "pending" });
    const messages = await db().select().from(notifications);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.topic).toBe("cms.comment_pending");
    await moderateReaderComment.call({ id: submitted.id, status: "approved" }, OWNER);
    const visible = await listReaderComments.call({ pageId: page.id }, ANONYMOUS);
    expect(visible).toHaveLength(1);
    expect(Object.keys(visible[0]!)).toEqual(["id", "parentId", "authorName", "body", "createdAt"]);
    const people = await db().select().from(contacts);
    expect(people).toHaveLength(1);
    expect(people[0]?.email).toBe("private@example.test");
    await submitReaderComment.call({ pageId: page.id, parentId: submitted.id, name: "Reply", email: "reply@example.test", body: "A reply" }, ANONYMOUS);
    const other = await post("another-post");
    await expect(submitReaderComment.call({ pageId: other.id, parentId: submitted.id, name: "No", email: "reply@example.test", body: "Wrong parent" }, ANONYMOUS)).rejects.toMatchObject({ code: "validation" });
    await moderateReaderComment.call({ id: submitted.id, status: "spam" }, OWNER);
    expect(await listReaderComments.call({ pageId: page.id }, ANONYMOUS)).toEqual([]);
  });

  it("respects honeypots, unpublished posts, site and post switches", async () => {
    const page = await post();
    const input = { pageId: page.id, name: "Reader", email: "reader@example.test", body: "A comment" };
    await submitReaderComment.call({ ...input, website: "spam" }, ANONYMOUS);
    expect(await db().select().from(comments)).toEqual([]);
    expect(await db().select().from(contacts)).toEqual([]);
    await updateBlogSettings.call({ commentsEnabled: false }, OWNER);
    await expect(submitReaderComment.call(input, ANONYMOUS)).rejects.toMatchObject({ code: "validation" });
    await updateBlogSettings.call({ commentsEnabled: true }, OWNER);
    await setPostMeta.call({ pageId: page.id, isPost: true, commentsEnabled: false }, OWNER);
    await expect(submitReaderComment.call(input, ANONYMOUS)).rejects.toMatchObject({ code: "validation" });
    await publishPage.call({ id: page.id, published: false }, OWNER);
    expect(await listReaderComments.call({ pageId: page.id }, ANONYMOUS)).toEqual([]);
  });

  it("moves and undoes contact references and includes comments in private export and erasure", async () => {
    const page = await post();
    const submitted = await submitReaderComment.call({ pageId: page.id, name: "Reader", email: "reader@example.test", body: "Private export includes this" }, ANONYMOUS);
    const [before] = await db().select().from(comments).where(eq(comments.id, submitted.id));
    const survivor = await createContact.call({ name: "Survivor", email: "survivor@example.test" }, OWNER);
    const merged = await mergeContacts.call({ survivingId: survivor.id, duplicateId: before!.contactId! }, OWNER);
    expect((await db().select().from(comments))[0]?.contactId).toBe(survivor.id);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect((await db().select().from(comments))[0]?.contactId).toBe(before!.contactId);
    const source = contactPrivacySources().find(item => item.scope === "cms.readerComments")!;
    const exported = await db().transaction(tx => source.exportData(tx, before!.contactId!));
    expect(JSON.stringify(exported)).toContain("Private export includes this");
    await db().transaction(tx => source.erase(tx, before!.contactId!, { requestId: crypto.randomUUID() }));
    expect(await db().select().from(comments)).toEqual([]);
  });

  it("withdraws comments, bylines and archives when the shared publication policy vetoes a post", async () => {
    const page = await post("revoked-reader-post");
    const category = await saveTerm.call({ taxonomy: "category", name: "Revoked category" }, OWNER);
    await setPostMeta.call({ pageId: page.id, isPost: true, categoryIds: [category.id] }, OWNER);
    const input = { pageId: page.id, name: "Reader", email: "revoked@example.test", body: "A held comment" };
    const submitted = await submitReaderComment.call(input, ANONYMOUS);
    await moderateReaderComment.call({ id: submitted.id, status: "approved" }, OWNER);
    registerPublishVeto({ id: "test.revoked-reader-post", appliesTo: one => one.id === page.id, blocks: () => Promise.resolve(true) });
    expect(await listReaderComments.call({ pageId: page.id }, ANONYMOUS)).toEqual([]);
    expect(await postMetaAt.call({ slug: page.slug }, ANONYMOUS)).toBeNull();
    expect(await resolveBlogArchive.call({ path: category.path }, ANONYMOUS)).toBeNull();
    expect(await publicBlogCategories.call({}, ANONYMOUS)).toEqual([]);
    await expect(submitReaderComment.call(input, ANONYMOUS)).rejects.toMatchObject({ code: "validation" });
  });

  it("keeps an original publication date when an owner republishes an edited post", async () => {
    const page = await post("original-date-after-edit");
    const original = "2025-03-14T18:00:00.000Z";
    await publishPage.call({ id: page.id, published: true, publishedAt: original }, OWNER);
    await updatePage.call({ id: page.id, title: "An edited post" }, OWNER);
    const published = await publishPage.call({ id: page.id, published: true }, OWNER);
    expect(published.publishedAt?.toISOString()).toBe(original);
    const meta = await postMetaAt.call({ slug: page.slug }, ANONYMOUS);
    expect(meta?.publishedAt?.toISOString()).toBe(original);
    expect(meta!.modifiedAt!.getTime()).toBeGreaterThan(Date.parse(original));
  });

  it("paginates approved history and the moderation queue without dropping older comments", async () => {
    const page = await post("paged-reader-history");
    await db().insert(comments).values([1, 2, 3].map(index => ({ pageId: page.id, authorName: `Reader ${index}`, body: `Comment ${index}`, status: "approved" as const, createdAt: new Date(`2025-01-0${index}T12:00:00Z`) })));
    const first = await listReaderComments.call({ pageId: page.id, limit: 2 }, ANONYMOUS);
    const next = await listReaderComments.call({ pageId: page.id, limit: 2, page: 2 }, ANONYMOUS);
    expect(first.map(comment => comment.body)).toEqual(["Comment 1", "Comment 2"]);
    expect(next.map(comment => comment.body)).toEqual(["Comment 3"]);
    expect((await listReaderCommentsForOwner.call({ limit: 2, page: 2 }, OWNER)).map(comment => comment.body)).toEqual(["Comment 1"]);
    await expect(listReaderCommentsForOwner.call({}, ANONYMOUS)).rejects.toMatchObject({ code: "forbidden" });
  });
});
