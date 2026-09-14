// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.17 reorder, purchase orders, receiving and backorders.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { eq } from "drizzle-orm";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import {
  applyVariantMatrix,
  availability,
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createProduct,
  createPurchaseOrder,
  createSupplier,
  enableInventory,
  getProductVariants,
  listInventory,
  listPurchaseOrders,
  listReorderQueue,
  placePurchaseOrder,
  receivePurchaseOrderLine,
  setInventoryLevels,
  setVariantStockPolicy,
  subscribeBackInStock,
} from "@/modules/catalog/service";
import {
  ANONYMOUS,
  CUSTOMER,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog procurement", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function setup() {
    const location = await createLocationService.call(
      { name: "Studio", slug: "studio", city: "Courtenay", country: "CA" },
      OWNER,
    );
    const product = await createProduct.call({ name: "Print", slug: "print", kind: "physical" }, OWNER);
    await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variants = await getProductVariants.call({ productId: product.id }, OWNER);
    const variant = variants.variants[0]!;
    const item = await enableInventory.call({ variantId: variant.id, locationId: location.id }, OWNER);
    return { location, variant, item };
  }

  it("lists a tracked item at its reorder point and honors backorder policy", async () => {
    const { item, variant, location } = await setup();
    await setInventoryLevels.call({ itemId: item.id, safetyStock: 2, reorderPoint: 5 }, OWNER);
    const queue = await listReorderQueue.call({}, OWNER);
    expect(queue.map((row) => row.id)).toContain(item.id);

    expect(
      await availability.call({ variantId: variant.id, locationId: location.id, quantity: 1 }, ANONYMOUS),
    ).toMatchObject({ tracked: true, available: false, backordered: false });

    await setVariantStockPolicy.call(
      { variantId: variant.id, backorderPolicy: "allow_silent" },
      OWNER,
    );
    expect(
      await availability.call({ variantId: variant.id, locationId: location.id, quantity: 1 }, ANONYMOUS),
    ).toMatchObject({ tracked: true, available: true, backordered: true });

    expect(
      (await failure(
        setVariantStockPolicy.call(
          { variantId: variant.id, backorderPolicy: "allow_date" },
          OWNER,
        ),
      )).message,
    ).toMatch(/restock date/);
  });

  it("refuses anonymous notification enrollment for a supplied contact ID", async () => {
    const { variant, location } = await setup();
    const contact = await createContact.call({ name: "Private", email: "private-stock@example.test" }, OWNER);
    await expect(subscribeBackInStock.call({ variantId: variant.id, contactId: contact.id, locationId: location.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  });

  it("lets the signed-in customer enroll only their own profile", async () => {
    const { variant, location } = await setup();
    await db().insert(users).values({ id: CUSTOMER.userId, email: "own-stock@example.test", role: "customer" });
    const own = await createContact.call({ name: "Own profile", email: "own-stock@example.test" }, OWNER);
    const other = await createContact.call({ name: "Other profile", email: "other-stock@example.test" }, OWNER);
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, own.id));
    const input = { variantId: variant.id, contactId: own.id, locationId: location.id };
    const subscription = await subscribeBackInStock.call(input, CUSTOMER);
    expect((await subscribeBackInStock.call(input, CUSTOMER)).id).toBe(subscription.id);
    await expect(subscribeBackInStock.call({ ...input, contactId: other.id }, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
    await expect(subscribeBackInStock.call(input, { kind: "agent", keyName: "read-only", scopes: ["catalog.listProducts"] })).rejects.toMatchObject({ code: "permission" });
  });

  it("places a PO to raise incoming, receives onto the shelf, and notifies subscribers", async () => {
    const { variant, location } = await setup();
    const contact = await createContact.call(
      { name: "Ada", email: "ada-stock@example.test" },
      OWNER,
    );
    await subscribeBackInStock.call(
      { variantId: variant.id, contactId: contact.id, locationId: location.id },
      OWNER,
    );
    const supplier = await createSupplier.call({ name: "Paper mill", currency: "CAD" }, OWNER);
    const order = await createPurchaseOrder.call(
      { supplierId: supplier.id, locationId: location.id },
      OWNER,
    );
    await addPurchaseOrderLine.call(
      { purchaseOrderId: order.id, variantId: variant.id, quantity: 8, unitCost: "4.50" },
      OWNER,
    );
    await placePurchaseOrder.call({ id: order.id }, OWNER);
    const afterPlace = await listInventory.call({ variantId: variant.id }, OWNER);
    expect(afterPlace[0]).toMatchObject({ incoming: 8, onHand: 0 });

    const placed = await listPurchaseOrders.call({ status: "ordered" }, OWNER);
    const received = await receivePurchaseOrderLine.call(
      { lineId: placed[0]!.lines[0]!.id, quantity: 8 },
      OWNER,
    );
    expect(received.status).toBe("received");
    const afterReceive = await listInventory.call({ variantId: variant.id }, OWNER);
    expect(afterReceive[0]).toMatchObject({ incoming: 0, onHand: 8 });
  });

  it("cancels an open PO and reverses remaining incoming", async () => {
    const { variant, location } = await setup();
    const supplier = await createSupplier.call({ name: "Ink co", currency: "CAD" }, OWNER);
    const order = await createPurchaseOrder.call(
      { supplierId: supplier.id, locationId: location.id },
      OWNER,
    );
    await addPurchaseOrderLine.call(
      { purchaseOrderId: order.id, variantId: variant.id, quantity: 4, unitCost: "1.00" },
      OWNER,
    );
    await placePurchaseOrder.call({ id: order.id }, OWNER);
    await cancelPurchaseOrder.call({ id: order.id }, OWNER);
    const rows = await listInventory.call({ variantId: variant.id }, OWNER);
    expect(rows[0]).toMatchObject({ incoming: 0, onHand: 0 });
  });
});
