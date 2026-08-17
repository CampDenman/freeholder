// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.15 service offerings, deposits, policies and payment modes.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createForm } from "@/modules/forms/service";
import {
  applyVariantMatrix,
  createCancellationPolicy,
  createPriceList,
  createProduct,
  deleteCancellationPolicy,
  getProductVariants,
  getServiceOffering,
  quoteServicePayment,
  setPriceListEntry,
  setPriceRule,
  upsertServiceOffering,
} from "@/modules/catalog/service";
import { applyServiceDeposit } from "@/modules/catalog/offerings";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("service deposit arithmetic", () => {
  it("takes none, a fixed minor amount, or a PPM share without floating point", () => {
    expect(applyServiceDeposit(10_000, "none", 0)).toBe(0);
    expect(applyServiceDeposit(10_000, "fixed", 2_500)).toBe(2_500);
    expect(applyServiceDeposit(10_000, "percent", 500_000)).toBe(5_000);
  });

  it("refuses a fixed deposit larger than the price", () => {
    expect(() => applyServiceDeposit(1_000, "fixed", 1_001)).toThrow(/cannot exceed/);
  });
});

describe.runIf(hasDatabase)("catalog service offerings", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function serviceProduct() {
    const product = await createProduct.call(
      { name: "Portrait session", slug: "portrait-session", kind: "service" },
      OWNER,
    );
    const withMatrix = await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const variants = await getProductVariants.call({ productId: product.id }, OWNER);
    return { product: withMatrix, variant: variants.variants[0]! };
  }

  it("refuses offerings on non-service products and reserved C6 attach-points", async () => {
    const print = await createProduct.call({ name: "Print", slug: "print", kind: "physical" }, OWNER);
    expect(
      (await failure(
        upsertServiceOffering.call(
          { productId: print.id, durationMin: 60, locationType: "in_person" },
          OWNER,
        ),
      )).message,
    ).toMatch(/only to service products/);

    const { product } = await serviceProduct();
    expect(
      (await failure(
        upsertServiceOffering.call(
          {
            productId: product.id,
            durationMin: 90,
            locationType: "in_person",
            calendarIds: ["00000000-0000-4000-8000-000000000099"],
          },
          OWNER,
        ),
      )).message,
    ).toMatch(/Calendars attach/);
    expect(
      (await failure(
        upsertServiceOffering.call(
          {
            productId: product.id,
            durationMin: 90,
            locationType: "virtual",
            waiverTemplateId: "00000000-0000-4000-8000-000000000098",
          },
          OWNER,
        ),
      )).message,
    ).toMatch(/Waiver templates attach/);
  });

  it("stores duration, deposit, intake form and policy, then quotes deposit/balance", async () => {
    const { product, variant } = await serviceProduct();
    const form = await createForm.call(
      { name: "Portrait intake", slug: "portrait-intake" },
      OWNER,
    );
    const policy = await createCancellationPolicy.call(
      { name: "48-hour window", freeUntilHours: 48, feeType: "forfeit_deposit" },
      OWNER,
    );
    const offering = await upsertServiceOffering.call(
      {
        productId: product.id,
        durationMin: 90,
        bufferBeforeMin: 15,
        bufferAfterMin: 15,
        locationType: "in_person",
        depositType: "percent",
        depositPercentPpm: 500_000,
        cancellationPolicyId: policy.id,
        intakeFormId: form.id,
        capacity: 2,
        assignment: "pool",
        travelTimeMin: 20,
      },
      OWNER,
    );
    expect(offering).toMatchObject({
      durationMin: 90,
      depositType: "percent",
      depositValue: 500_000,
      capacity: 2,
      assignment: "pool",
      calendarIds: [],
      waiverTemplateId: null,
      intakeFormId: form.id,
      cancellationPolicyId: policy.id,
    });
    expect(await getServiceOffering.call({ productId: product.id }, OWNER)).toMatchObject({
      id: offering.id,
    });

    const retail = await createPriceList.call(
      { name: "CAD retail", currency: "CAD", kind: "retail", priority: 1 },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: retail.id, variantId: variant.id, amount: "200.00" },
      OWNER,
    );
    await setPriceRule.call({ productId: product.id, mode: "full" }, OWNER);
    await setPriceRule.call({ productId: product.id, mode: "deposit_balance" }, OWNER);

    const full = await quoteServicePayment.call(
      { productId: product.id, currency: "CAD", mode: "full" },
      OWNER,
    );
    expect(full).toMatchObject({
      available: true,
      priceMinor: 20_000,
      dueNowMinor: 20_000,
      depositMinor: 10_000,
    });
    const split = await quoteServicePayment.call(
      { productId: product.id, currency: "CAD", mode: "deposit_balance" },
      ANONYMOUS,
    );
    expect(split).toMatchObject({
      available: true,
      depositMinor: 10_000,
      balanceMinor: 10_000,
      dueNowMinor: 10_000,
    });
  });

  it("requires a deposit before deposit/balance and a schedule before a plan", async () => {
    const { product } = await serviceProduct();
    await upsertServiceOffering.call(
      { productId: product.id, durationMin: 60, locationType: "virtual" },
      OWNER,
    );
    expect(
      (await failure(
        setPriceRule.call({ productId: product.id, mode: "deposit_balance" }, OWNER),
      )).message,
    ).toMatch(/needs a service deposit/);
    expect(
      (await failure(
        setPriceRule.call({ productId: product.id, mode: "payment_plan" }, OWNER),
      )).message,
    ).toMatch(/2 and 36 installments/);
    const plan = await setPriceRule.call(
      { productId: product.id, mode: "payment_plan", installmentCount: 4, intervalDays: 30 },
      OWNER,
    );
    expect(plan.planSchedule).toEqual({ installmentCount: 4, intervalDays: 30 });
  });

  it("will not delete a cancellation policy an offering still uses", async () => {
    const { product } = await serviceProduct();
    const policy = await createCancellationPolicy.call({ name: "Keep me" }, OWNER);
    await upsertServiceOffering.call(
      {
        productId: product.id,
        durationMin: 45,
        locationType: "virtual",
        cancellationPolicyId: policy.id,
      },
      OWNER,
    );
    expect(
      (await failure(deleteCancellationPolicy.call({ id: policy.id }, OWNER))).message,
    ).toMatch(/still uses/);
  });
});
