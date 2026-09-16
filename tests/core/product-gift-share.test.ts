// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gift-card and registry-style product sharing (MASTER.md C9.35, §34).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createContact } from "@/core/contacts/service";
import { giftCards, wishlists } from "@/modules/catalog/schema";
import {
  addWishlistItem,
  applyVariantMatrix,
  createProduct,
  createPriceList,
  getProductVariants,
  giftCardByShareToken,
  issueGiftCard,
  sendGiftCard,
  setPriceListEntry,
  shareWishlist,
  wishlistByShareToken,
} from "@/modules/catalog/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("product gift and registry sharing", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
  }, 60_000);
  afterAll(closeDb);

  async function variant() {
    const product = await createProduct.call(
      { name: "Print", slug: "print", kind: "physical" },
      OWNER,
    );
    const updated = await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const bundle = await getProductVariants.call({ productId: updated.id }, OWNER);
    const row = bundle.variants[0]!;
    const list = await createPriceList.call(
      { name: "CAD retail", currency: "CAD", kind: "retail" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: list.id, variantId: row.id, amount: "40.00" },
      OWNER,
    );
    return row;
  }

  it("refuses to share an empty gift list", async () => {
    const contact = await createContact.call({ name: "Rae", email: "rae@example.test" }, OWNER);
    expect(
      (await failure(shareWishlist.call({ contactId: contact.id }, OWNER))).message,
    ).toContain("nothing on this gift list");
  });

  it("publishes a wishlist as a public registry without exposing the contact", async () => {
    const contact = await createContact.call({ name: "Rae", email: "rae@example.test" }, OWNER);
    const item = await variant();
    await addWishlistItem.call({ contactId: contact.id, variantId: item.id }, OWNER);
    const shared = await shareWishlist.call({ contactId: contact.id }, OWNER);
    expect(shared.link).toContain("/registry/");
    const viewed = await wishlistByShareToken.call({ token: shared.token }, ANONYMOUS);
    expect(viewed?.items).toHaveLength(1);
    expect(viewed?.items[0]?.productName).toBe("Print");
    expect(JSON.stringify(viewed)).not.toContain("rae@example.test");
    expect(await wishlistByShareToken.call({ token: "not-a-real-token-value-xx" }, ANONYMOUS)).toBeNull();
  });

  it("sends a gift card as a claim link resolved onto the contact spine", async () => {
    const card = await issueGiftCard.call(
      { code: "GIFT-ABCD12", currency: "CAD", amount: "25.00" },
      OWNER,
    );
    const sent = await sendGiftCard.call(
      { id: card.id, email: "partner@example.test", name: "Sam Partner" },
      OWNER,
    );
    expect(sent.link).toContain("/gift/");
    expect(sent.contactId).toBeTruthy();
    const opened = await giftCardByShareToken.call({ token: sent.token }, ANONYMOUS);
    expect(opened).toMatchObject({
      code: "GIFT-ABCD12",
      remainingMinor: 2500,
      currency: "CAD",
    });
    const [row] = await db().select().from(giftCards).where(eq(giftCards.id, card.id));
    expect(row!.contactId).toBe(sent.contactId);
    expect(row!.shareTokenHash).toBeTruthy();
    expect(row!.shareTokenHash).not.toBe(sent.token);
  });

  it("rotates the wishlist share token so the old link dies", async () => {
    const contact = await createContact.call({ name: "Rae", email: "rae@example.test" }, OWNER);
    const item = await variant();
    await addWishlistItem.call({ contactId: contact.id, variantId: item.id }, OWNER);
    const first = await shareWishlist.call({ contactId: contact.id }, OWNER);
    const second = await shareWishlist.call({ contactId: contact.id }, OWNER);
    expect(second.token).not.toBe(first.token);
    expect(await wishlistByShareToken.call({ token: first.token }, ANONYMOUS)).toBeNull();
    expect(await wishlistByShareToken.call({ token: second.token }, ANONYMOUS)).not.toBeNull();
    const [row] = await db().select().from(wishlists).where(eq(wishlists.contactId, contact.id));
    expect(row!.shareTokenHash).toBeTruthy();
  });
});
