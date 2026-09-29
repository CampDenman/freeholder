// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product collections — the taxonomy layer (C3.25 slice 1, gap G1 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// Six claims:
//
//   1. A collection is owner-curated identity with a unique public address,
//      stale-write refusal, and the same slug-redirect promise products make.
//   2. Membership is either manual (pinned rows the owner orders) or derived
//      (a saved segment's purchases, recomputed wholesale) — never both.
//   3. The recompute job is idempotent: a second run deletes what the first
//      wrote and writes the same answer again.
//   4. Removal is trash (C11.14): the slug stays reserved, restore returns
//      the same row, purge frees the address — and the products grouped by a
//      collection are never touched by any of it.
//   5. The public surface resolves published collections only, filters
//      membership to what a storefront may render, and feeds the sitemap.
//   6. Permission refusals are service-boundary facts, not UI conveniences.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { redirects } from "@/core/seo/schema";
import { contacts } from "@/core/contacts/schema";
import { removeSegment, saveSegment } from "@/core/segments/service";
import {
  collectionProducts,
  orderItems,
  orders,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import {
  addCollectionProduct,
  collectionPaths,
  createCollection,
  createProduct,
  getCollection,
  listCollections,
  listProducts,
  purgeCollection,
  removeCollection,
  removeCollectionProduct,
  reorderCollectionProducts,
  resolvePublicCollection,
  restoreCollection,
  recomputeCollectionMembership,
  updateCollection,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { activateProduct } from "@/modules/catalog/service";
import { kindFromSlug } from "@/core/seo/classify";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("catalog collections", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    // saveSegment records created_by against the users table.
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });
  afterAll(closeDb);

  async function product(slug: string, name = slug) {
    const created = await createProduct.call({ name, slug, kind: "physical" }, OWNER);
    const [variant] = await db()
      .insert(productVariants)
      .values({ productId: created.id, combinationKey: "default", sku: `sku-${slug}`, isDefault: true })
      .returning();
    return { product: created, variant: variant! };
  }

  async function paidOrder(contactId: string, variantId: string) {
    const [order] = await db()
      .insert(orders)
      .values({ contactId, currency: "CAD", status: "paid", totalMinor: 1_000 })
      .returning();
    await db().insert(orderItems).values({
      orderId: order!.id,
      variantId,
      quantity: 1,
      unitAmountMinor: 1_000,
      lineTotalMinor: 1_000,
    });
    return order!;
  }

  async function person(email: string, country: string): Promise<string> {
    const [row] = await db()
      .insert(contacts)
      .values({ email, name: email.split("@")[0]!, country })
      .returning();
    return row!.id;
  }

  it("creates, reads, and updates a collection with stale-write refusal and slug uniqueness", async () => {
    const created = await createCollection.call(
      { title: "Summer picks", slug: "summer-picks", description: "The season's best" },
      OWNER,
    );
    expect(created).toMatchObject({
      title: "Summer picks",
      slug: "summer-picks",
      ruleType: "manual",
      sortOrder: "manual",
      published: false,
      version: 1,
    });

    const read = await getCollection.call({ id: created.id }, OWNER);
    expect(read.collection.id).toBe(created.id);
    expect(read.total).toBe(0);

    const updated = await updateCollection.call(
      {
        id: created.id,
        expectedVersion: created.version,
        title: "Summer favourites",
        seo: { title: "Best of summer", description: "Our picks for the season" },
        sortOrder: "title",
        published: true,
      },
      OWNER,
    );
    expect(updated).toMatchObject({ title: "Summer favourites", sortOrder: "title", published: true, version: 2 });

    const stale = await failure(
      updateCollection.call({ id: created.id, expectedVersion: created.version, title: "Again" }, OWNER),
    );
    expect(stale).toMatchObject({ code: "conflict" });

    const taken = await failure(createCollection.call({ title: "Other", slug: "summer-picks" }, OWNER));
    expect(taken).toMatchObject({ code: "conflict" });
    expect(taken.message).toContain("/c/summer-picks");
  });

  it("leaves a permanent redirect when a published collection moves addresses", async () => {
    const created = await createCollection.call({ title: "Edits", slug: "edits" }, OWNER);
    await updateCollection.call({ id: created.id, expectedVersion: 1, published: true }, OWNER);
    await updateCollection.call({ id: created.id, expectedVersion: 2, slug: "edited" }, OWNER);

    const [row] = await db()
      .select()
      .from(redirects)
      .where(and(eq(redirects.fromPath, "c/edits"), eq(redirects.toPath, "c/edited")))
      .limit(1);
    expect(row).toMatchObject({ status: "301" });

    // §5's other half: the new address resolves, the old one redirects.
    expect(kindFromSlug("c/edited")).toBe("collection");
    expect((await resolvePublicCollection.call({ slug: "edited" }, ANONYMOUS)).collection?.slug).toBe("edited");
  });

  it("refuses anonymous and customer actors at the service boundary", async () => {
    const created = await createCollection.call({ title: "Members only", slug: "members-only" }, OWNER);
    await expect(createCollection.call({ title: "Nope", slug: "nope" }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
    await expect(createCollection.call({ title: "Nope", slug: "nope" }, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
    await expect(getCollection.call({ id: created.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
    await expect(updateCollection.call({ id: created.id, expectedVersion: 1, title: "Nope" }, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
    await expect(addCollectionProduct.call({ collectionId: created.id, productId: created.id }, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
  });

  it("curates manual membership: add, duplicate refusal, remove with compaction, exact reorder", async () => {
    const a = await product("cap-a", "Cap A");
    const b = await product("cap-b", "Cap B");
    const c = await product("cap-c", "Cap C");
    const collection = await createCollection.call({ title: "Caps", slug: "caps" }, OWNER);

    await addCollectionProduct.call({ collectionId: collection.id, productId: a.product.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: b.product.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: c.product.id }, OWNER);
    const duplicate = await failure(
      addCollectionProduct.call({ collectionId: collection.id, productId: a.product.id }, OWNER),
    );
    expect(duplicate).toMatchObject({ code: "conflict" });

    const listed = await getCollection.call({ id: collection.id }, OWNER);
    expect(listed.products.map((row) => row.productId)).toEqual([a.product.id, b.product.id, c.product.id]);
    expect(listed.products.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(listed.total).toBe(3);

    await removeCollectionProduct.call({ collectionId: collection.id, productId: b.product.id }, OWNER);
    const afterRemove = await getCollection.call({ id: collection.id }, OWNER);
    expect(afterRemove.products.map((row) => [row.productId, row.position])).toEqual([
      [a.product.id, 0],
      [c.product.id, 1],
    ]);

    await reorderCollectionProducts.call(
      { collectionId: collection.id, productIds: [c.product.id, a.product.id] },
      OWNER,
    );
    const reordered = await getCollection.call({ id: collection.id }, OWNER);
    expect(reordered.products.map((row) => row.productId)).toEqual([c.product.id, a.product.id]);

    const wrongSet = await failure(
      reorderCollectionProducts.call({ collectionId: collection.id, productIds: [c.product.id] }, OWNER),
    );
    expect(wrongSet).toMatchObject({ code: "validation" });

    const missing = await failure(
      removeCollectionProduct.call({ collectionId: collection.id, productId: b.product.id }, OWNER),
    );
    expect(missing).toMatchObject({ code: "not_found" });
  });

  it("lists a collection's membership through the products filter, in stored order", async () => {
    const a = await product("tee-a", "Tee A");
    const b = await product("tee-b", "Tee B");
    const collection = await createCollection.call({ title: "Tees", slug: "tees" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: a.product.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: b.product.id }, OWNER);
    await reorderCollectionProducts.call(
      { collectionId: collection.id, productIds: [b.product.id, a.product.id] },
      OWNER,
    );

    const rows = await listProducts.call({ collectionId: collection.id }, OWNER);
    expect(rows.map((row) => row.id)).toEqual([b.product.id, a.product.id]);
  });

  it("derives segment membership from what the segment's contacts bought, idempotently", async () => {
    const vip = await saveSegment.call(
      {
        name: "VIP buyers",
        definition: { match: "all", rules: [{ field: "contact.country", op: "is", value: "CA" }] },
      },
      OWNER,
    );
    const insider = await person("insider@example.test", "CA");
    const outsider = await person("outsider@example.test", "US");
    const bought = await product("vip-print", "VIP print");
    const skipped = await product("casual-print", "Casual print");
    const pendingOnly = await product("pending-print", "Pending print");
    await paidOrder(insider, bought.variant.id);
    await paidOrder(outsider, skipped.variant.id);
    // A basket is not a purchase: a pending order must not derive membership.
    const [basket] = await db()
      .insert(orders)
      .values({ contactId: insider, currency: "CAD", status: "pending_payment" })
      .returning();
    await db().insert(orderItems).values({
      orderId: basket!.id,
      variantId: pendingOnly.variant.id,
      quantity: 1,
      unitAmountMinor: 500,
      lineTotalMinor: 500,
    });

    const collection = await createCollection.call(
      {
        title: "VIP wall",
        slug: "vip-wall",
        ruleType: "segment",
        ruleConfig: { segmentId: vip.id },
      },
      OWNER,
    );

    const first = await recomputeCollectionMembership.call({ id: collection.id }, { kind: "system" });
    expect(first.matched).toBe(1);
    let membership = await getCollection.call({ id: collection.id }, OWNER);
    expect(membership.products.map((row) => row.productId)).toEqual([bought.product.id]);
    expect(membership.total).toBe(1);

    // Idempotency: the second run rewrites the same answer, not a copy of it.
    const second = await recomputeCollectionMembership.call({ id: collection.id }, { kind: "system" });
    expect(second.matched).toBe(1);
    membership = await getCollection.call({ id: collection.id }, OWNER);
    expect(membership.products.map((row) => row.productId)).toEqual([bought.product.id]);
    const rows = await db()
      .select()
      .from(collectionProducts)
      .where(eq(collectionProducts.collectionId, collection.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses hand-edits and non-segment recompute, and fails closed when the segment is trashed", async () => {
    const vip = await saveSegment.call(
      {
        name: "Repeat buyers",
        definition: { match: "all", rules: [{ field: "contact.country", op: "is", value: "CA" }] },
      },
      OWNER,
    );
    const buyer = await person("buyer@example.test", "CA");
    const art = await product("repeat-art", "Repeat art");
    await paidOrder(buyer, art.variant.id);
    const collection = await createCollection.call(
      { title: "Repeats", slug: "repeats", ruleType: "segment", ruleConfig: { segmentId: vip.id } },
      OWNER,
    );

    const manualAdd = await failure(
      addCollectionProduct.call({ collectionId: collection.id, productId: art.product.id }, OWNER),
    );
    expect(manualAdd).toMatchObject({ code: "conflict" });
    const manualReorder = await failure(
      reorderCollectionProducts.call({ collectionId: collection.id, productIds: [art.product.id] }, OWNER),
    );
    expect(manualReorder).toMatchObject({ code: "conflict" });

    const manual = await createCollection.call({ title: "By hand", slug: "by-hand" }, OWNER);
    const wrongKind = await failure(
      recomputeCollectionMembership.call({ id: manual.id }, { kind: "system" }),
    );
    expect(wrongKind).toMatchObject({ code: "validation" });

    // A trashed segment stops answering (C7.04): the next recompute empties
    // the collection rather than leaving yesterday's audience on the wall.
    await recomputeCollectionMembership.call({ id: collection.id }, { kind: "system" });
    expect((await getCollection.call({ id: collection.id }, OWNER)).total).toBe(1);
    await removeSegment.call({ id: vip.id }, OWNER);
    const recomputed = await recomputeCollectionMembership.call({ id: collection.id }, { kind: "system" });
    expect(recomputed.matched).toBe(0);
    expect((await getCollection.call({ id: collection.id }, OWNER)).total).toBe(0);
  });

  it("validates the segment rule at save time", async () => {
    const withoutSegment = await failure(
      createCollection.call({ title: "No segment", slug: "no-segment", ruleType: "segment" }, OWNER),
    );
    expect(withoutSegment).toMatchObject({ code: "validation" });

    const bogus = await failure(
      createCollection.call(
        { title: "Bogus", slug: "bogus", ruleType: "segment", ruleConfig: { segmentId: "00000000-0000-4000-8000-0000000000ff" } },
        OWNER,
      ),
    );
    expect(bogus).toMatchObject({ code: "not_found" });

    const manualWithSegment = await failure(
      createCollection.call(
        { title: "Mixed", slug: "mixed", ruleType: "manual", ruleConfig: { segmentId: "00000000-0000-4000-8000-0000000000ff" } },
        OWNER,
      ),
    );
    expect(manualWithSegment).toMatchObject({ code: "validation" });
  });

  it("resolves published collections publicly, filtering membership to the sellable", async () => {
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const visibleProduct = await createProduct.call(
      { name: "Visible print", slug: "visible-print", kind: "physical", taxCategoryId: tax.id },
      OWNER,
    );
    await activateProduct.call({ id: visibleProduct.id, expectedVersion: visibleProduct.version }, OWNER);
    const draft = await product("draft-print", "Draft print");

    const collection = await createCollection.call({ title: "Wall", slug: "wall" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: visibleProduct.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: draft.product.id }, OWNER);

    // Unpublished: the public read does not exist yet.
    expect((await resolvePublicCollection.call({ slug: "wall" }, ANONYMOUS)).collection).toBeNull();
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);

    const resolved = await resolvePublicCollection.call({ slug: "wall" }, ANONYMOUS);
    expect(resolved.collection?.title).toBe("Wall");
    expect(resolved.products.map((row) => row.slug)).toEqual(["visible-print"]);
    expect(resolved.total).toBe(1);

    // Trashed: dark everywhere, immediately.
    await removeCollection.call({ id: collection.id }, OWNER);
    expect((await resolvePublicCollection.call({ slug: "wall" }, ANONYMOUS)).collection).toBeNull();
    expect(await collectionPaths.call({ locale: "en" }, ANONYMOUS)).toEqual([]);
  });

  it("advertises published collections to the sitemap with collection kind", async () => {
    const collection = await createCollection.call({ title: "Shelf", slug: "shelf" }, OWNER);
    await createCollection.call({ title: "Dark", slug: "dark-shelf" }, OWNER);
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);

    const paths = await collectionPaths.call({ locale: "en" }, ANONYMOUS);
    expect(paths).toEqual([
      expect.objectContaining({ slug: "c/shelf", title: "Shelf", kind: "collection" }),
    ]);
    expect(paths.find((entry) => entry.slug === "c/shelf")?.updatedAt).toBeInstanceOf(Date);
  });

  it("trashes, restores and purges without ever touching the products", async () => {
    const art = await product("kept-art", "Kept art");
    const collection = await createCollection.call({ title: "Keeps", slug: "keeps" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: art.product.id }, OWNER);

    await removeCollection.call({ id: collection.id }, OWNER);
    expect(await listCollections.call({}, OWNER)).toEqual([]);
    const trashed = await listCollections.call({ trashedOnly: true }, OWNER);
    expect(trashed.map((row) => row.id)).toEqual([collection.id]);
    await expect(getCollection.call({ id: collection.id }, OWNER)).rejects.toMatchObject({ code: "not_found" });

    // The slug stays reserved while the collection recovers (C11.14).
    const blocked = await failure(createCollection.call({ title: "Impostor", slug: "keeps" }, OWNER));
    expect(blocked).toMatchObject({ code: "conflict" });

    await restoreCollection.call({ id: collection.id }, OWNER);
    const restored = await getCollection.call({ id: collection.id }, OWNER);
    expect(restored.collection.title).toBe("Keeps");
    expect(restored.products.map((row) => row.productId)).toEqual([art.product.id]);

    await removeCollection.call({ id: collection.id }, OWNER);
    await purgeCollection.call({ id: collection.id, confirmation: "PURGE" }, OWNER);
    expect(await listCollections.call({ trashedOnly: true }, OWNER)).toEqual([]);

    // Purge freed the address…
    const replacement = await createCollection.call({ title: "Keeps again", slug: "keeps" }, OWNER);
    expect(replacement.slug).toBe("keeps");
    // …and the product outlived every step of its collection's lifecycle.
    const surviving = await listProducts.call({}, OWNER);
    expect(surviving.map((row) => row.id)).toContain(art.product.id);
  });

  it("sorts membership by title or newest at read time when asked", async () => {
    const a = await product("alpha-zeta", "Alpha");
    const b = await product("beta-york", "Beta");
    // Separate the timestamps so "newest" has an unambiguous answer.
    await db()
      .update(products)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(products.id, b.product.id));
    const collection = await createCollection.call(
      { title: "Sorted", slug: "sorted", sortOrder: "title" },
      OWNER,
    );
    await addCollectionProduct.call({ collectionId: collection.id, productId: b.product.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: a.product.id }, OWNER);

    const byTitle = await getCollection.call({ id: collection.id }, OWNER);
    expect(byTitle.products.map((row) => row.productId)).toEqual([a.product.id, b.product.id]);

    await updateCollection.call({ id: collection.id, expectedVersion: 1, sortOrder: "newest" }, OWNER);
    const byNewest = await getCollection.call({ id: collection.id }, OWNER);
    expect(byNewest.products.map((row) => row.productId)).toEqual([b.product.id, a.product.id]);
  });

  it("paginates membership reads with a matching total", async () => {
    const collection = await createCollection.call({ title: "Pages", slug: "pages" }, OWNER);
    const made = [];
    for (let index = 0; index < 5; index += 1) {
      made.push(await product(`page-${index}`, `Page ${index}`));
    }
    for (const entry of made) {
      await addCollectionProduct.call({ collectionId: collection.id, productId: entry.product.id }, OWNER);
    }
    const pageTwo = await getCollection.call({ id: collection.id, limit: 2, offset: 2 }, OWNER);
    expect(pageTwo.products.map((row) => row.name)).toEqual(["Page 2", "Page 3"]);
    expect(pageTwo.total).toBe(5);
  });
});
