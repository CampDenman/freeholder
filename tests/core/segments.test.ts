// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one definition of "who" (C7.04, MASTER.md §4.14).
//
// §4.14: "Segments are the one definition of 'who'. The same saved query drives
// a campaign's audience, a price list's eligibility, an automation's entry
// condition and a report's cohort. A platform with four incompatible ways to
// say 'customers in Ontario who bought twice' is four places to be wrong."
//
// Five claims:
//
//   1. **That sentence, literally.** A segment can express "customers in
//      Ontario who bought twice", crossing core and a module.
//   2. **A rule nothing can answer is refused, never ignored.** Silently
//      dropping one would widen an audience — which is how a campaign reaches
//      people who were meant to be excluded.
//   3. **Explainability is running the rules**, one at a time, against one
//      person. A described answer would be a second implementation.
//   4. **Static means frozen.** Who received the March email must not change in
//      April because somebody's lifecycle stage moved.
//   5. **A price list asks the same question through the same door**, so
//      pricing and every later audience surface cannot disagree about who is a
//      wholesale customer.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { orders } from "@/modules/catalog/schema";
import { segmentMembers, segments } from "@/core/segments/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  captureSegment,
  contactInSegment,
  explainMembership,
  listSegmentFields,
  listSegments,
  previewSegment,
  saveSegment,
  segmentMembership,
} from "@/core/segments/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("segments", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function person(
    email: string,
    fields: Partial<typeof contacts.$inferInsert> = {},
  ): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email, name: email.split("@")[0]!, source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    if (Object.keys(fields).length > 0) {
      await db().update(contacts).set(fields).where(eq(contacts.id, resolved.contact.id));
    }
    return resolved.contact.id;
  }

  async function boughtTimes(contactId: string, times: number): Promise<void> {
    for (let n = 0; n < times; n += 1) {
      await db()
        .insert(orders)
        .values({ contactId, currency: "GBP", status: "paid", totalMinor: 10_000 });
    }
  }

  it("offers what core knows and what a module adds", async () => {
    const fields = await listSegmentFields.call({}, OWNER);
    const keys = fields.map((field) => field.key);
    expect(keys).toContain("contact.lifecycleStage");
    expect(keys).toContain("bookings.completedCount");
    // Registered from the catalog module, not listed in core.
    expect(keys).toContain("orders.paidCount");
    expect(fields.find((field) => field.key === "orders.paidCount")?.source).toBe("catalog");
  });

  // §4.14's own sentence, made executable.
  it("says customers in Ontario who bought twice", async () => {
    const wanted = await person("ontario-twice@example.test", {
      country: "CA",
      lifecycleStage: "customer",
    });
    await boughtTimes(wanted, 2);
    const wrongPlace = await person("elsewhere@example.test", {
      country: "GB",
      lifecycleStage: "customer",
    });
    await boughtTimes(wrongPlace, 2);
    const boughtOnce = await person("once@example.test", {
      country: "CA",
      lifecycleStage: "customer",
    });
    await boughtTimes(boughtOnce, 1);

    const preview = await previewSegment.call(
      {
        definition: {
          match: "all",
          rules: [
            { field: "contact.country", op: "is", value: "CA" },
            { field: "orders.paidCount", op: "atLeast", value: 2 },
          ],
        },
      },
      OWNER,
    );
    expect(preview.count).toBe(1);
    expect(preview.sample.map((one) => one.id)).toEqual([wanted]);
  });

  it("counts what somebody spent, not what they nearly spent", async () => {
    const spender = await person("spender@example.test");
    await boughtTimes(spender, 3);
    await db()
      .insert(orders)
      .values({
        contactId: spender,
        currency: "GBP",
        status: "cancelled",
        totalMinor: 500_000,
      });

    const preview = await previewSegment.call(
      {
        definition: {
          match: "all",
          // £300 in minor units: the abandoned £5,000 must not count.
          rules: [{ field: "orders.totalSpentMinor", op: "atLeast", value: 30_000 }],
        },
      },
      OWNER,
    );
    expect(preview.count).toBe(1);

    const tooMuch = await previewSegment.call(
      {
        definition: {
          match: "all",
          rules: [{ field: "orders.totalSpentMinor", op: "atLeast", value: 100_000 }],
        },
      },
      OWNER,
    );
    expect(tooMuch.count).toBe(0);
  });

  // The failure that matters: a rule nobody can answer must not simply vanish.
  it("refuses a rule about something nothing knows", async () => {
    const refused = await failure(
      previewSegment.call(
        {
          definition: {
            match: "all",
            rules: [{ field: "unicorns.count", op: "atLeast", value: 1 }],
          },
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("switched off");
  });

  it("refuses an operator a field cannot answer", async () => {
    const refused = await failure(
      previewSegment.call(
        {
          definition: {
            match: "all",
            rules: [{ field: "orders.paidCount", op: "contains", value: "two" }],
          },
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("cannot be asked");
  });

  it("treats one of nothing as nobody, not everybody", async () => {
    await person("anyone@example.test");
    const preview = await previewSegment.call(
      {
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "isOneOf", value: [] }],
        },
      },
      OWNER,
    );
    // The other reading sends a campaign to the world.
    expect(preview.count).toBe(0);
  });

  it("means any rule when asked for any", async () => {
    await person("ca@example.test", { country: "CA" });
    await person("gb@example.test", { country: "GB" });
    const preview = await previewSegment.call(
      {
        definition: {
          match: "any",
          rules: [
            { field: "contact.country", op: "is", value: "CA" },
            { field: "contact.country", op: "is", value: "GB" },
          ],
        },
      },
      OWNER,
    );
    expect(preview.count).toBe(2);
  });

  it("saves a count with the moment it was taken beside it", async () => {
    await person("counted@example.test", { lifecycleStage: "customer" });
    const saved = await saveSegment.call(
      {
        name: "Customers",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    expect(saved).toMatchObject({ slug: "customers", kind: "dynamic", memberCountCached: 1 });
    expect(saved.lastEvaluatedAt).toBeTruthy();

    const listed = await listSegments.call({}, OWNER);
    expect(listed).toHaveLength(1);
  });

  it("refuses a second segment with the same name", async () => {
    const definition = {
      match: "all" as const,
      rules: [{ field: "contact.lifecycleStage", op: "is" as const, value: "customer" }],
    };
    await saveSegment.call({ name: "Customers", definition }, OWNER);
    const refused = await failure(saveSegment.call({ name: "Customers", definition }, OWNER));
    expect(refused.message).toContain("already");
  });

  it("re-answers a live segment as the world changes", async () => {
    const someone = await person("moving@example.test", { lifecycleStage: "lead" });
    const saved = await saveSegment.call(
      {
        name: "Customers",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    expect(await segmentMembership.call({ id: saved.id }, OWNER)).toHaveLength(0);

    await db()
      .update(contacts)
      .set({ lifecycleStage: "customer" })
      .where(eq(contacts.id, someone));
    // No re-save, no re-evaluation step: a live segment is the query.
    expect(await segmentMembership.call({ id: saved.id }, OWNER)).toHaveLength(1);
  });

  // "Who received the March email" must not change in April.
  it("holds a frozen segment still while the world moves", async () => {
    const someone = await person("frozen@example.test", { lifecycleStage: "customer" });
    const saved = await saveSegment.call(
      {
        name: "March send",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    const captured = await captureSegment.call({ id: saved.id }, OWNER);
    expect(captured.count).toBe(1);

    await db().update(contacts).set({ lifecycleStage: "lead" }).where(eq(contacts.id, someone));
    // They no longer match the rules and are still in the list that went out.
    expect(await segmentMembership.call({ id: saved.id }, OWNER)).toHaveLength(1);
    const [after] = await db().select().from(segments).where(eq(segments.id, saved.id));
    expect(after!.kind).toBe("static");
    expect(after!.capturedAt).toBeTruthy();
  });

  it("refuses to freeze the same segment twice", async () => {
    await person("once-frozen@example.test", { lifecycleStage: "customer" });
    const saved = await saveSegment.call(
      {
        name: "Frozen once",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    await captureSegment.call({ id: saved.id }, OWNER);
    const refused = await failure(captureSegment.call({ id: saved.id }, OWNER));
    // Freezing it again would rewrite who it says it went to.
    expect(refused.message).toContain("already");
  });

  it("refuses to thaw a frozen segment back into a live one", async () => {
    await person("thaw@example.test", { lifecycleStage: "customer" });
    const definition = {
      match: "all" as const,
      rules: [{ field: "contact.lifecycleStage", op: "is" as const, value: "customer" }],
    };
    const saved = await saveSegment.call({ name: "Sent list", definition }, OWNER);
    await captureSegment.call({ id: saved.id }, OWNER);
    const refused = await failure(
      saveSegment.call({ id: saved.id, name: "Sent list", kind: "dynamic", definition }, OWNER),
    );
    expect(refused.message).toContain("stays captured");
  });

  // The explanation is the query, run one rule at a time.
  it("says why somebody is in, rule by rule", async () => {
    const someone = await person("why@example.test", {
      country: "CA",
      lifecycleStage: "lead",
    });
    const saved = await saveSegment.call(
      {
        name: "Canadian customers",
        definition: {
          match: "all",
          rules: [
            { field: "contact.country", op: "is", value: "CA" },
            { field: "contact.lifecycleStage", op: "is", value: "customer" },
          ],
        },
      },
      OWNER,
    );
    const why = await explainMembership.call({ id: saved.id, contactId: someone }, OWNER);
    expect(why.member).toBe(false);
    expect(why.reasons.map((reason) => reason.passed)).toEqual([true, false]);
    expect(why.reasons[1]).toMatchObject({ label: "Lifecycle stage", op: "is", value: "customer" });
  });

  it("explains a frozen segment by what was captured, not by today's rules", async () => {
    const someone = await person("captured-why@example.test", { lifecycleStage: "customer" });
    const saved = await saveSegment.call(
      {
        name: "Captured",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    await captureSegment.call({ id: saved.id }, OWNER);
    await db().update(contacts).set({ lifecycleStage: "lead" }).where(eq(contacts.id, someone));

    const why = await explainMembership.call({ id: saved.id, contactId: someone }, OWNER);
    // Re-running the rules would explain today's world, not the one the send
    // went out into.
    expect(why.member).toBe(true);
    expect(why.reasons[0]!.field).toBe("segment.captured");
  });

  it("answers the one-person question a price list asks", async () => {
    const inside = await person("inside@example.test", { lifecycleStage: "customer" });
    const outside = await person("outside@example.test", { lifecycleStage: "lead" });
    const saved = await saveSegment.call(
      {
        name: "Trade",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    expect(await contactInSegment.call({ slug: "trade", contactId: inside }, OWNER)).toEqual({
      member: true,
    });
    expect(await contactInSegment.call({ id: saved.id, contactId: outside }, OWNER)).toEqual({
      member: false,
    });
  });

  // The reuse claim, and the reason C7.04 exists at all: pricing asks the same
  // question through the same door, so a price list and a campaign cannot
  // disagree about who is a wholesale customer.
  it("prices somebody by the segment they are in", async () => {
    const {
      applyVariantMatrix,
      createPriceList,
      createProduct,
      getProductVariants,
      resolvePrice,
      setPriceListEntry,
    } = await import("@/modules/catalog/service");

    const product = await createProduct.call(
      { name: "Print", slug: "print", kind: "physical" },
      OWNER,
    );
    const updated = await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const item = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;

    const trade = await saveSegment.call(
      {
        name: "Trade buyers",
        definition: {
          match: "all",
          rules: [{ field: "orders.paidCount", op: "atLeast", value: 2 }],
        },
      },
      OWNER,
    );

    const retail = await createPriceList.call(
      { name: "GBP retail", currency: "GBP", kind: "retail", priority: 1 },
      OWNER,
    );
    const wholesale = await createPriceList.call(
      {
        name: "GBP wholesale",
        currency: "GBP",
        kind: "wholesale",
        segmentId: trade.id,
        priority: 5,
      },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: retail.id, variantId: item.id, amount: "80.00" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: wholesale.id, variantId: item.id, amount: "60.00" },
      OWNER,
    );

    const regular = await person("regular@example.test");
    await boughtTimes(regular, 2);
    const newcomer = await person("newcomer@example.test");

    const forRegular = await resolvePrice.call(
      { variantId: item.id, currency: "GBP", contactId: regular },
      OWNER,
    );
    expect(forRegular).toMatchObject({ available: true, amountMinor: 6_000 });

    const forNewcomer = await resolvePrice.call(
      { variantId: item.id, currency: "GBP", contactId: newcomer },
      OWNER,
    );
    expect(forNewcomer).toMatchObject({ available: true, amountMinor: 8_000 });

    // An anonymous basket cannot be in a list defined by who somebody is.
    const forNobody = await resolvePrice.call({ variantId: item.id, currency: "GBP" }, OWNER);
    expect(forNobody).toMatchObject({ available: true, amountMinor: 8_000 });
  });

  it("takes a frozen membership with somebody who is forgotten", async () => {
    const someone = await person("erased@example.test", { lifecycleStage: "customer" });
    const saved = await saveSegment.call(
      {
        name: "Erasure",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    await captureSegment.call({ id: saved.id }, OWNER);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.segments");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, someone, { requestId: "t" }));

    expect(await db().select().from(segmentMembers)).toHaveLength(0);
    // The segment itself is the business's own definition and survives.
    expect(await db().select().from(segments)).toHaveLength(1);
  });

  it("keeps one frozen membership when two records become one", async () => {
    const survivor = await person("keep@example.test", { lifecycleStage: "customer" });
    const duplicate = await person("keep.dup@example.test", { lifecycleStage: "customer" });
    const saved = await saveSegment.call(
      {
        name: "Merge",
        definition: {
          match: "all",
          rules: [{ field: "contact.lifecycleStage", op: "is", value: "customer" }],
        },
      },
      OWNER,
    );
    await captureSegment.call({ id: saved.id }, OWNER);
    expect(await db().select().from(segmentMembers)).toHaveLength(2);

    await getService("contacts.merge").call(
      { survivingId: survivor, duplicateId: duplicate },
      OWNER,
    );
    const after = await db().select().from(segmentMembers);
    // One row per pair: the duplicate's is folded in rather than colliding.
    expect(after).toHaveLength(1);
    expect(after[0]!.contactId).toBe(survivor);
  });
});
