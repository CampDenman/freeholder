// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual isolated process admits and dispatches one synthetic original product GET.
import { z } from "zod";
const operationId = z.uuid().parse(process.argv[2]);
let atOriginalGet: (() => Promise<void>) | undefined;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== "https://api.stripe.com" || init.method !== "GET") throw Error("The interrupted product reader allows only its synthetic original Stripe GET.");
  if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
  if (url.pathname === "/v1/products/prod_actualProducer") { await atOriginalGet?.(); return new Promise<Response>(() => { /* actual GET remains unresolved until this process is stopped */ }); }
  throw Error("Unexpected synthetic interrupted product GET path.");
};
async function readOriginalProduct() {
  try {
    const [{ recoverMerchantPhaseProduct }, { subscriptionProviderReadTickets }, { db }, { eq }] = await Promise.all([
      import("@/modules/subscriptions/provider-phase-product-recovery"), import("@/modules/subscriptions/provider-read-ownership-schema"), import("@/core/db"), import("drizzle-orm"),
    ]);
    atOriginalGet = async () => {
      const [read] = await db().select({ readId: subscriptionProviderReadTickets.readId }).from(subscriptionProviderReadTickets).where(eq(subscriptionProviderReadTickets.operationId, operationId));
      if (!read || !process.send) throw Error("The actual original child read ticket/channel is unavailable.");
      process.send(read);
    };
    await recoverMerchantPhaseProduct.call({ operationId }, { kind: "system" });
    throw Error("The interrupted actual product GET unexpectedly completed.");
  } catch (error) { process.send?.({ error: error instanceof Error ? error.message : "Interrupted actual product reader failed." }); process.exitCode = 1; }
}
// Keep dynamic imports inside an async entry for the repository's CommonJS loader.
void readOriginalProduct();
