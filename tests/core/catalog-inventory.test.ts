// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.16 append-only stock ledger, reservations and transfers.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { stockReservations } from "@/modules/catalog/schema";
import { createLocationService } from "@/core/locations/service";
import {
  applyVariantMatrix,
  availability,
  consumeReservation,
  countStock,
  createProduct,
  enableInventory,
  expireReservations,
  getProductVariants,
  listInventory,
  listStockMovements,
  recordDamage,
  recordStockMovement,
  reserveStock,
  transferStock,
} from "@/modules/catalog/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog inventory", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function setup(slug = "print") {
    const studio = await createLocationService.call(
      {
        name: "Studio",
        slug: `${slug}-studio`,
        city: "Courtenay",
        country: "CA",
      },
      OWNER,
    );
    const warehouse = await createLocationService.call(
      {
        name: "Warehouse",
        slug: `${slug}-warehouse`,
        city: "Cumberland",
        country: "CA",
      },
      OWNER,
    );
    const product = await createProduct.call(
      { name: "Print", slug, kind: "physical" },
      OWNER,
    );
    await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const variants = await getProductVariants.call({ productId: product.id }, OWNER);
    return { studio, warehouse, variant: variants.variants[0]! };
  }

  it("treats an untracked variant as always available", async () => {
    const { variant, studio } = await setup("untracked");
    const check = await availability.call(
      { variantId: variant.id, locationId: studio.id, quantity: 12 },
      ANONYMOUS,
    );
    expect(check).toMatchObject({ tracked: false, available: true });
  });

  it("derives on-hand from the movement ledger and refuses a negative shelf", async () => {
    const { variant, studio } = await setup("ledger");
    const item = await enableInventory.call(
      { variantId: variant.id, locationId: studio.id, bin: "A1" },
      OWNER,
    );
    await recordStockMovement.call(
      { itemId: item.id, delta: 10, reason: "receipt", note: "opening" },
      OWNER,
    );
    await recordDamage.call({ itemId: item.id, quantity: 2, note: "cracked glass" }, OWNER);
    const counted = await countStock.call({ itemId: item.id, quantity: 7, note: "shelf count" }, OWNER);
    expect(counted.balance).toMatchObject({ onHand: 7, reserved: 0, available: 7 });
    expect(
      (await failure(
        recordStockMovement.call({ itemId: item.id, delta: -8, reason: "adjustment", note: "too far" }, OWNER),
      )).message,
    ).toMatch(/not enough stock on hand/);
    const [row] = await listInventory.call({ variantId: variant.id }, OWNER);
    expect(row).toMatchObject({ onHand: 7, available: 7, bin: "A1" });
    const ledger = await listStockMovements.call({ itemId: item.id }, OWNER);
    expect(ledger.map((entry) => entry.delta)).toEqual([-1, -2, 10]);
  });

  it("transfers between locations in one transaction", async () => {
    const { variant, studio, warehouse } = await setup("xfer");
    const source = await enableInventory.call(
      { variantId: variant.id, locationId: studio.id },
      OWNER,
    );
    await recordStockMovement.call(
      { itemId: source.id, delta: 5, reason: "receipt" },
      OWNER,
    );
    const moved = await transferStock.call(
      { fromItemId: source.id, toLocationId: warehouse.id, quantity: 3 },
      OWNER,
    );
    expect(moved.from).toMatchObject({ onHand: 2, available: 2 });
    expect(moved.to).toMatchObject({ onHand: 3, available: 3 });
    expect(moved.outgoing.referenceId).toBe(moved.incoming.referenceId);
    expect(
      (await failure(
        transferStock.call({ fromItemId: source.id, toLocationId: warehouse.id, quantity: 4 }, OWNER),
      )).message,
    ).toMatch(/not enough stock on hand/);
  });

  it("holds reserved units without changing on-hand, then sale or expiry", async () => {
    const { variant, studio } = await setup("hold");
    const item = await enableInventory.call(
      { variantId: variant.id, locationId: studio.id },
      OWNER,
    );
    await recordStockMovement.call({ itemId: item.id, delta: 4, reason: "receipt" }, OWNER);
    const hold = await reserveStock.call(
      {
        variantId: variant.id,
        locationId: studio.id,
        quantity: 3,
        holderType: "cart",
        holderId: "00000000-0000-4000-8000-000000000111",
        expiresAt: new Date(Date.now() + 60_000),
      },
      ANONYMOUS,
    );
    expect(hold.tracked).toBe(true);
    expect(hold.balance).toMatchObject({ onHand: 4, reserved: 3, available: 1 });
    expect(
      (await failure(
        reserveStock.call(
          {
            variantId: variant.id,
            locationId: studio.id,
            quantity: 2,
            holderType: "cart",
            holderId: "00000000-0000-4000-8000-000000000112",
            expiresAt: new Date(Date.now() + 60_000),
          },
          ANONYMOUS,
        ),
      )).message,
    ).toMatch(/not enough available stock/);

    const sold = await consumeReservation.call({ id: hold.reservation!.id }, OWNER);
    expect(sold.balance).toMatchObject({ onHand: 1, reserved: 0, available: 1 });

    await recordStockMovement.call({ itemId: item.id, delta: 2, reason: "return" }, OWNER);
    const timed = await reserveStock.call(
      {
        variantId: variant.id,
        locationId: studio.id,
        quantity: 2,
        holderType: "order",
        holderId: "00000000-0000-4000-8000-000000000114",
        expiresAt: new Date(Date.now() + 60_000),
      },
      ANONYMOUS,
    );
    await db()
      .update(stockReservations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(stockReservations.id, timed.reservation!.id));
    expect(await expireReservations.call({}, OWNER)).toEqual({ expired: 1 });
    const afterExpiry = await availability.call(
      { variantId: variant.id, locationId: studio.id, quantity: 3 },
      ANONYMOUS,
    );
    expect(afterExpiry).toMatchObject({ tracked: true, available: true, canPromise: 3 });
  });
});
