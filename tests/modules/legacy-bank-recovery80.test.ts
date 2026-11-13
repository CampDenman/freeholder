// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual old callers, exact causal money and a real stopped process.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { legacyBankReaderRecoveryPlan, reviewLegacyBankReaderStopped, LEGACY_READER_STOP_CONFIRMATION } from "@/modules/invoicing/legacy-bank-reader-recovery";
import { LEGACY_REPLACEMENT_CONFIRMATION, LEGACY_REPLACEMENT_PROTOCOL } from "@/modules/invoicing/legacy-bank-replacement-proof";
import { replaceLegacyReturnedBankRefund } from "@/modules/invoicing/legacy-bank-replacement-service";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes, legacyBankReadStops, legacyBankCurrentReceipts } from "@/modules/invoicing/legacy-bank-read-schema";
import { merchantRefundRequests } from "@/modules/invoicing/merchant-refund-schema";
import { invoiceRefundStates } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { moneyStateEvents, refunds } from "@/modules/invoicing/schema";
import { legacyRecoveryFixture } from "../helpers/legacy-bank-recovery";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
async function drain() { await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb(); }
describe.runIf(hasDatabase)("authentic legacy bank recovery80", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(async () => { vi.restoreAllMocks(); await drain(); }); afterAll(drain);
  it("keeps an equal unrelated refund separate, replaces only the exact failed promise, and replays without another physical key", async () => {
    const actual = await legacyRecoveryFixture(), unrelated = await actual.submit("legacy-recovery-equal-unrelated");
    actual.status(actual.original.providerRef!, "failed");
    expect(await actual.recover()).toMatchObject({ status: "failed", applied: true }); await actual.balances(400);
    const before = (await invoiceRefundStates.call({ invoiceId: actual.invoice.id }, OWNER)).find(row => row.id === actual.original.id);
    expect(before).toMatchObject({ refundPromiseOpen: true, promiseFulfilledElsewhere: false, legacy: true, canReplace: true });
    const httpBefore = actual.paths.length;
    expect(await failure(replaceLegacyReturnedBankRefund.call({ refundId: actual.original.id, confirmation: LEGACY_REPLACEMENT_CONFIRMATION }, { ...OWNER, keyScopes: ["invoicing.replaceLegacyReturnedBankRefund"] }))).toMatchObject({ code: "permission" });
    expect(actual.paths).toHaveLength(httpBefore);
    const replaced = await actual.replace(); expect(replaced.state).toBe("fulfilled"); expect(replaced.refund.id).not.toBe(unrelated.id);
    await actual.balances(800); expect(actual.posts).toHaveLength(3); expect(new Set(actual.posts).size).toBe(3);
    expect((await actual.replace()).refund.id).toBe(replaced.refund.id); expect(actual.posts).toHaveLength(3); await actual.balances(800);
    const customer = await actual.customerInvoice(); expect(customer.canPay).toBe(false);
    expect(customer.refunds.find(row => row.id === actual.original.id)).toMatchObject({ refundPromiseOpen: false, promiseFulfilledElsewhere: true, reviewRequired: false });
    const journal = await db().select().from(moneyStateEvents).where(sql`${moneyStateEvents.metadata}->>'protocol'=${LEGACY_REPLACEMENT_PROTOCOL}`);
    expect(journal).toHaveLength(1); expect(journal[0]!.metadata).toMatchObject({ rootRefundId: actual.original.id, parentRefundId: actual.original.id, replacementRefundId: replaced.refund.id,
      originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
    for (const read of await db().select().from(legacyBankReads)) expect(read.original).toMatchObject({ originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
  });
  it("cannot settle the original cash inventory while another actual accepted refund caller is still paused", async () => {
    const actual = await legacyRecoveryFixture(), paused = actual.pauseNextSubmission();
    const pending = actual.submit("legacy-recovery-other-accepted-caller").then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([paused.entered.promise.then(() => "entered"), pending.then(() => "ended")])).toBe("entered");
      actual.status(actual.original.providerRef!, "failed");
      await expect(actual.recover()).rejects.toThrow(); await expect(actual.replace()).rejects.toThrow();
      expect(actual.posts).toHaveLength(2); await actual.balances(400);
      expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(0);
      const raw = await db().select().from(legacyBankReadFacts); expect(raw.some(fact => fact.kind === "inventory_refund" && z.record(z.string(), z.unknown()).parse(fact.evidence.actual).providerRef !== actual.original.providerRef)).toBe(true);
      paused.release.resolve(); expect(await pending).toHaveProperty("value");
      expect(await actual.recover()).toMatchObject({ status: "failed", applied: true }); await actual.balances(400);
      expect((await actual.replace()).state).toBe("fulfilled"); await actual.balances(800); expect(actual.posts).toHaveLength(3);
    } finally { paused.release.resolve(); await pending; }
  });
  it("retains cash and blocks more keys when a causal journal is changed to point at an equal unrelated refund", async () => {
    const actual = await legacyRecoveryFixture(), unrelated = await actual.submit("legacy-recovery-equal-unrelated");
    actual.status(actual.original.providerRef!, "failed"); const replaced = await actual.replace(); expect(replaced.state).toBe("fulfilled"); await actual.balances(800);
    const [journal] = await db().select().from(moneyStateEvents).where(sql`${moneyStateEvents.metadata}->>'protocol'=${LEGACY_REPLACEMENT_PROTOCOL}`);
    if (!journal) throw Error("The actual signed original legacy replacement receipt is unavailable.");
    const metadata = z.record(z.string(), z.unknown()).parse(journal.metadata);
    await db().update(moneyStateEvents).set({ metadata: { ...metadata, replacementRefundId: unrelated.id } }).where(eq(moneyStateEvents.id, journal.id));
    await expect(actual.submit("legacy-recovery-key-after-corruption")).rejects.toThrow(); await expect(actual.replace()).rejects.toThrow();
    await actual.balances(800); expect(actual.posts).toHaveLength(3);
    expect((await actual.customerInvoice()).refunds.find(row => row.id === actual.original.id)).toMatchObject({ refundPromiseOpen: true, reviewRequired: true, promiseFulfilledElsewhere: false });
    expect((await db().select().from(refunds).where(eq(refunds.id, replaced.refund.id)))[0]?.status).toBe("succeeded");
  });
  it("retains newly observed excess positive cash and refuses another replacement instead of clamping or inventing a waiver", async () => {
    const actual = await legacyRecoveryFixture(); await actual.submit("legacy-recovery-equal-unrelated"); actual.status(actual.original.providerRef!, "failed");
    expect((await actual.replace()).state).toBe("fulfilled"); await actual.balances(800);
    actual.status(actual.original.providerRef!, "succeeded");
    await expect(actual.replace()).rejects.toThrow(); expect(actual.posts).toHaveLength(3); await actual.balances(800);
    const reads = await db().select().from(legacyBankReads).where(eq(legacyBankReads.refundId, actual.original.id));
    const facts = await db().select().from(legacyBankReadFacts).where(sql`${legacyBankReadFacts.readId} in (${sql.join(reads.map(read => sql`${read.id}::uuid`), sql`,`)})`);
    expect(facts.some(fact => fact.kind === "exact_refund" && fact.evidence.rawProviderStatus === "succeeded")).toBe(true);
    expect(facts.some(fact => fact.kind === "cash_inventory" && z.record(z.string(), z.unknown()).parse(fact.evidence.actual).amountRefundedMinor === 1200)).toBe(true);
    expect((await actual.customerInvoice()).refunds.find(row => row.id === actual.original.id)).toMatchObject({ refundPromiseOpen: true, reviewRequired: true });
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
  });
  it.runIf(process.platform === "linux")("reviews only an actually stopped original reader, preserves its two committed facts without a forged finish, and starts a fresh actual read", async () => {
    const actual = await legacyRecoveryFixture(), require = createRequire(import.meta.url);
    const loader = require.resolve("tsx/esm", { paths: [dirname(require.resolve("vite/package.json"))] });
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_legacy_interrupted_reader_fixture_only", STRIPE_WEBHOOK_SECRET: "whsec_legacy_interrupted_reader_fixture_only" };
    delete childEnv.FREEHOLDER_JOBS; delete childEnv.NEXT_PHASE;
    const child = spawn(process.execPath, ["--import", pathToFileURL(loader).href, fileURLToPath(new URL("../fixtures/legacy-bank-interrupted-reader.ts", import.meta.url)), actual.original.id, actual.original.providerRef!, actual.paymentRef],
      { cwd: process.cwd(), env: childEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    // Capture only bounded diagnostic text; fixture source contains no real
    // provider credential, external request or owner claim path.
    child.stdout?.resume();
    let diagnostics = ""; child.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
    let ended = false; child.once("exit", () => { ended = true; });
    try {
      const ticket = await new Promise<{ readId: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("The actual child reader did not reach its retained callback barrier.")), 30000);
        child.once("message", message => { clearTimeout(timeout); const parsed = z.object({ readId: z.uuid() }).safeParse(message); if (parsed.success) resolve(parsed.data); else reject(Error(`Actual child reader failed before barrier: ${diagnostics}`)); });
        child.once("error", error => { clearTimeout(timeout); reject(error); });
        child.once("exit", code => { clearTimeout(timeout); reject(Error(`Actual child reader exited ${code} before barrier: ${diagnostics}`)); });
      });
      const [read] = await db().select().from(legacyBankReads).where(eq(legacyBankReads.id, ticket.readId)); if (!read) throw Error("No actual original child read ticket.");
      const input = { readId: read.id, expectedCallerId: read.caller.id, expectedOriginalDigest: read.originalDigest, expectedSourceRevision: read.sourceRevision,
        hostingEvidence: "Synthetic hosting review for the exact original child process; its actual exit is awaited before positive review.", confirmation: LEGACY_READER_STOP_CONFIRMATION };
      expect((await legacyBankReaderRecoveryPlan.call({ invoiceId: actual.invoice.id }, OWNER))[0]).toMatchObject({ readId: read.id, liveness: "live", pid: child.pid });
      expect(await failure(reviewLegacyBankReaderStopped.call(input, OWNER))).toMatchObject({ code: "conflict" });
      expect(await db().select().from(legacyBankReadStops)).toHaveLength(0);
      const [inventory] = await db().select().from(legacyBankReadFacts).where(eq(legacyBankReadFacts.readId, read.id)); expect(inventory).toBeDefined();
      expect(await db().select().from(legacyBankReadFacts).where(eq(legacyBankReadFacts.readId, read.id))).toHaveLength(2);
      const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
      expect(await reviewLegacyBankReaderStopped.call(input, OWNER)).toMatchObject({ reviewed: true, mechanicalCheck: "original_process_absent" });
      expect(await db().select().from(legacyBankReadFinishes).where(eq(legacyBankReadFinishes.readId, read.id))).toHaveLength(0);
      expect(await db().select().from(legacyBankCurrentReceipts).where(eq(legacyBankCurrentReceipts.readId, read.id))).toHaveLength(0); await actual.balances(400);
      await expect(db().transaction(async tx => {
        await tx.execute(sql`select set_config('freeholder.legacy_bank_read_v1','1',true)`);
        await tx.insert(legacyBankReadFacts).values({ readId: read.id, sequence: 3, kind: inventory!.kind, evidence: inventory!.evidence, evidenceDigest: inventory!.evidenceDigest });
      })).rejects.toThrow();
      expect(await actual.recover()).toMatchObject({ status: "succeeded", applied: true }); await actual.balances(400); expect(actual.posts).toHaveLength(1);
      expect(await db().select().from(legacyBankReadStops)).toHaveLength(1);
      expect(await db().select().from(legacyBankReadFacts).where(eq(legacyBankReadFacts.readId, read.id))).toHaveLength(2);
      expect(await db().select().from(legacyBankReads).where(eq(legacyBankReads.refundId, actual.original.id))).toHaveLength(2);
      expect(await db().select().from(legacyBankReadFinishes)).toHaveLength(1);
      expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(1);
      expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
      expect(await db().select().from(refunds).where(and(eq(refunds.paymentId, actual.payment.id), eq(refunds.id, actual.original.id)))).toHaveLength(1);
    } finally {
      if (!ended) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
    }
  });
});
