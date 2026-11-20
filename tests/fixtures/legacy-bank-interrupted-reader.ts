// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: an actual isolated process owns and dispatches this read.
// Dynamic imports ensure the real Stripe factory captures the fixture fetch.
import { z } from "zod";
const refundId = z.uuid().parse(process.argv[2]);
const providerRefund = z.string().regex(/^(?:pyr|re)_[A-Za-z0-9_]+$/).parse(process.argv[3]);
const paymentRef = z.string().regex(/^pi_[A-Za-z0-9_]+$/).parse(process.argv[4]);
let sendPaused: (() => Promise<void>) | undefined;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== "https://api.stripe.com" || init.method !== "GET") throw Error("The interrupted reader permits only its synthetic original Stripe GETs.");
  if (url.pathname === "/v1/account") return Response.json({ id: "acct_LegacyRecoveryRead" });
  if (url.pathname === `/v1/refunds/${providerRefund}`) return Response.json({ id: providerRefund, payment_intent: paymentRef, charge: "ch_LegacyRecovery", amount: 400, currency: "cad", status: "succeeded" });
  if (url.pathname === `/v1/payment_intents/${paymentRef}`) return Response.json({ id: paymentRef, status: "succeeded", amount_received: 1000, currency: "cad", latest_charge: "ch_LegacyRecovery", amount_capturable: 0 });
  if (url.pathname === "/v1/charges/ch_LegacyRecovery") {
    await sendPaused?.(); return new Promise<Response>(() => { /* actual provider call stays outstanding until the process is stopped */ });
  }
  throw Error("The interrupted reader received an unexpected provider path.");
};
async function readOriginalInChild() {
  try {
    const [{ inspectLegacyBankRefund }, { db }, { legacyBankReads }, { eq }] = await Promise.all([
      import("@/modules/invoicing/legacy-bank-read-service"), import("@/core/db"), import("@/modules/invoicing/legacy-bank-read-schema"), import("drizzle-orm"),
    ]);
    sendPaused = async () => {
      const [read] = await db().select({ id: legacyBankReads.id }).from(legacyBankReads).where(eq(legacyBankReads.refundId, refundId));
      if (!read || !process.send) throw Error("The actual child read ticket or its parent channel is unavailable.");
      process.send({ readId: read.id });
    };
    await inspectLegacyBankRefund.call({ refundId }, { kind: "system" });
    throw Error("The interrupted reader unexpectedly completed its outstanding provider request.");
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "Interrupted reader failed." }); process.exitCode = 1;
  }
}

// The repository is CommonJS to Node; keep async imports inside the actual child.
void readOriginalInChild();
