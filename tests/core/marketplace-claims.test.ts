// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: expired workers cannot import or checkpoint another sync's work.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { marketplaceChannels, marketplaceOrders } from "../../plugins/marketplace/schema";
import { closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" as const };
type Claim = { channelId: string; leaseToken: string; cursor: string | null };

describe.runIf(hasDatabase)("marketplace sync leases", { timeout: 30_000 }, () => {
  beforeEach(async () => { await ready(); await truncateSpine(); });
  afterAll(closeDb);

  async function channel() {
    const [created] = await db().insert(marketplaceChannels).values({ name: "Lease test", provider: "shopify", status: "connected", externalRef: "shop" }).returning();
    return created!;
  }
  async function claim(channelId: string): Promise<Claim> {
    return await getService("marketplace.claimSync").call({ channelId }, SYSTEM) as Claim;
  }

  it("admits one active worker and fences it out after expiry and recovery", async () => {
    const source = await channel();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => claim(source.id)));
    const accepted = results.filter((entry): entry is PromiseFulfilledResult<Claim> => entry.status === "fulfilled");
    expect(accepted).toHaveLength(1);
    const original = accepted[0]!.value;
    await db().update(marketplaceChannels).set({ syncLeaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(marketplaceChannels.id, source.id));
    const recovered = await claim(source.id);
    expect(recovered.leaseToken).not.toBe(original.leaseToken);
    expect((await failure(getService("marketplace.applySync").call({ ...original, completed: true }, SYSTEM))).code).toBe("conflict");
    const order = { externalRef: "leased-order", description: "A product", amountMinor: 2500, currency: "CAD", buyerEmail: "buyer@example.test", buyerName: "Buyer" };
    expect((await failure(getService("marketplace.importProviderOrder").call({ ...original, order }, SYSTEM))).code).toBe("conflict");
    expect(await db().select().from(contacts).where(eq(contacts.email, order.buyerEmail))).toHaveLength(0);
    expect(await getService("marketplace.importProviderOrder").call({ ...recovered, order }, SYSTEM)).toBe(true);
    expect(await getService("marketplace.importProviderOrder").call({ ...recovered, order }, SYSTEM)).toBe(false);
    expect(await db().select().from(marketplaceOrders)).toHaveLength(1);
    await getService("marketplace.applySync").call({ ...recovered, completed: true }, SYSTEM);
    const [finished] = await db().select().from(marketplaceChannels).where(eq(marketplaceChannels.id, source.id));
    expect(finished).toMatchObject({ status: "connected", syncLeaseToken: null, syncLeaseExpiresAt: null });
  });

  it("rolls back contact resolution when the invoice cannot be created", async () => {
    const source = await channel();
    const claimed = await claim(source.id);
    const email = "rollback@example.test";
    const previous = await getService("contacts.resolve").call({ email: "existing@example.test", name: "Existing", source: "test" }, SYSTEM) as { contact: { id: string } };
    const identity = `marketplace:${source.id}:conflicting-order`;
    await getService("invoicing.createDraft").call({ contactId: previous.contact.id, currency: "CAD",
      sourceType: "order", sourceId: identity, idempotencyKey: identity,
      lines: [{ description: "Existing purchase", quantityMicros: 1_000_000, unitAmountMinor: 1500 }],
      tax: { mode: "not_applicable", reason: "Imported marketplace order; tax was collected on the channel." },
    }, SYSTEM);
    const error = await failure(getService("marketplace.importProviderOrder").call({ ...claimed, order: {
      externalRef: "conflicting-order", description: "Product", amountMinor: 2500,
      currency: "CAD", buyerEmail: email, buyerName: "Rollback",
    } }, SYSTEM));
    expect(error.code).toBe("conflict");
    expect(await db().select().from(contacts).where(eq(contacts.email, email))).toHaveLength(0);
    expect(await db().select().from(marketplaceOrders)).toHaveLength(0);
  });
});
