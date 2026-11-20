// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual stopped child, original signed ticket, independent review and new GET.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { subscriptionProviderReadFinishes, subscriptionProviderReadStops, subscriptionProviderReadTickets } from "@/modules/subscriptions/provider-read-ownership-schema";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { PROVIDER_READER_STOP_CONFIRMATION, providerReaderRecoveryPlan, recoverProviderReader, reviewProviderReaderStopped } from "@/modules/subscriptions/provider-reader-recovery";
import { recoverMerchantPhaseProduct } from "@/modules/subscriptions/provider-phase-product-recovery";
import { invoices, payments } from "@/modules/invoicing/schema";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("authentic original subscription reader runtime recovery", { timeout: 60000 }, () => {
  let source: Awaited<ReturnType<typeof seedActualProviderSubscription80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { source?.fixture.cleanup(); source = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it.runIf(process.platform === "linux")("refuses a live original child, records its actual exit separately, and only then admits a new actual GET", async () => {
    source = await seedActualProviderSubscription80();
    const product = (await source.operations()).find(operation => operation.kind === "create_product"); if (!product) throw Error("No actual original product creation.");
    const before = product.providerObservation, require = createRequire(import.meta.url), loader = require.resolve("tsx", { paths: [dirname(require.resolve("vite/package.json"))] });
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_subscription_interrupted_reader_fixture_only", STRIPE_WEBHOOK_SECRET: "whsec_subscription_interrupted_reader_fixture_only" };
    delete childEnv.FREEHOLDER_JOBS; delete childEnv.NEXT_PHASE;
    const child = spawn(process.execPath, ["--import", pathToFileURL(loader).href, fileURLToPath(new URL("../fixtures/subscription-interrupted-product-reader.ts", import.meta.url)), product.id],
      { cwd: process.cwd(), env: childEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    child.stdout?.resume(); let diagnostics = "", ended = false;
    child.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); }); child.once("exit", () => { ended = true; });
    try {
      const ticket = await new Promise<{ readId: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("The actual child product GET did not reach its committed admission barrier.")), 30000);
        child.once("message", message => { clearTimeout(timeout); const value = z.object({ readId: z.uuid() }).safeParse(message); if (value.success) resolve(value.data); else { const reported = z.object({ error: z.string() }).safeParse(message); reject(Error(reported.success ? reported.data.error : diagnostics)); } });
        child.once("error", error => { clearTimeout(timeout); reject(error); }); child.once("exit", code => { clearTimeout(timeout); reject(Error(`Child exited ${code} before actual GET barrier: ${diagnostics}`)); });
      });
      const [plan] = await providerReaderRecoveryPlan.call({ subscriptionId: product.subscriptionId }, OWNER); if (!plan) throw Error("No exact original read recovery plan.");
      expect(plan).toMatchObject({ readId: ticket.readId, liveness: "live", historicalBirthUnknown: false, reviewed: false });
      const review = { subscriptionId: product.subscriptionId, operationId: product.id, readId: plan.readId, expectedCallerId: plan.callerId, expectedAdmissionDigest: plan.admissionDigest,
        expectedSourceRevision: plan.sourceRevision, hostingEvidence: "Synthetic hosting proof for this exact original child; its actual exit is awaited before any positive stop review.", confirmation: PROVIDER_READER_STOP_CONFIRMATION };
      await expect(reviewProviderReaderStopped.call(review, OWNER)).rejects.toMatchObject({ code: "conflict" });
      await expect(reviewProviderReaderStopped.call(review, { ...OWNER, keyScopes: ["subscriptions.reviewProviderReaderStopped"] })).rejects.toMatchObject({ code: "permission" });
      await expect(recoverMerchantPhaseProduct.call({ operationId: product.id }, { kind: "system" })).rejects.toMatchObject({ code: "conflict" });
      expect(await db().select().from(subscriptionProviderReadStops)).toHaveLength(0);
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      expect(await reviewProviderReaderStopped.call(review, OWNER)).toMatchObject({ reviewed: true, mechanicalCheck: "original_process_absent" });
      expect(await db().select().from(subscriptionProviderReadFinishes).where(eq(subscriptionProviderReadFinishes.readId, ticket.readId))).toHaveLength(0);
      const [stopped] = await db().select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, product.id));
      expect((stopped!.providerObservation.history as unknown[]).slice(0, (before.history as unknown[]).length)).toEqual(before.history);
      await expect(db().transaction(async tx => {
        await tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
        await tx.update(subscriptionProviderScheduleOperations).set({ providerObservation: { ...stopped!.providerObservation, history: [...stopped!.providerObservation.history as unknown[],
          { source: "phase_product_read_finished", operationId: product.id, readId: ticket.readId, requestDigest: product.requestDigest, outcome: "returned" }] } }).where(eq(subscriptionProviderScheduleOperations.id, product.id));
      })).rejects.toThrow();
      expect(await recoverProviderReader.call({ subscriptionId: product.subscriptionId, operationId: product.id }, OWNER)).toEqual({ verified: true });
      expect(await db().select().from(subscriptionProviderReadTickets)).toHaveLength(2);
      expect(await db().select().from(subscriptionProviderReadFinishes)).toHaveLength(1); expect(await db().select().from(subscriptionProviderReadStops)).toHaveLength(1);
      const [resource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, product.subscriptionId)); expect(resource?.recoveryPending).toBe(false);
      expect(source.remote.productPosts()).toBe(1); expect(source.remote.schedulePosts()).toBe(0); expect(await db().select().from(invoices)).toHaveLength(0); expect(await db().select().from(payments)).toHaveLength(0);
    } finally { if (!ended) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; } }
  });
});
