// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ServiceContext, Tx } from "@/core/service";
import witnessBatch from "../../deploy/controlled-financial-witness-batch88.source.json";
import publicBoundary from "../../deploy/controlled-safe-public-boundary88.source.json";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";

const { controlledProviderWitnesses } = vi.hoisted(() => ({
  controlledProviderWitnesses: vi.fn(async () => { throw new Error("controlled stop"); }),
}));
vi.mock("@/modules/subscriptions/controlled-provider-witnesses", () => ({
  controlledProviderWitnesses,
  exportControlledProviderHistory: vi.fn(),
}));

import { createOriginalCashClosureShare } from "@/modules/invoicing/original-cash-closure-current";
import { originalMerchantRefundDebtShared } from "@/modules/invoicing/merchant-refund-debt";
import { controlledCashFinancialHistoryShared } from "@/modules/invoicing/controlled-provider-financial-witness";

describe("per-principal read sharing", () => {
  it("shares refund-debt rejection only for the exact payment and invocation", async () => {
    const select = vi.fn(() => { throw new Error("refund stop"); });
    const ctx = { tx: { select } } as unknown as ServiceContext, share = createOriginalCashClosureShare();
    await expect(Promise.all([
      originalMerchantRefundDebtShared(ctx, "payment", share),
      originalMerchantRefundDebtShared(ctx, "payment", share),
    ])).rejects.toThrow("refund stop");
    expect(select).toHaveBeenCalledTimes(1);

    await expect(originalMerchantRefundDebtShared(ctx, "other-payment", share)).rejects.toThrow("refund stop");
    expect(select).toHaveBeenCalledTimes(2);
    await expect(originalMerchantRefundDebtShared(ctx, "payment", createOriginalCashClosureShare())).rejects.toThrow("refund stop");
    expect(select).toHaveBeenCalledTimes(3);
    await expect(originalMerchantRefundDebtShared(ctx, "payment")).rejects.toThrow("refund stop");
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("requires sorted exact controlled-history arguments and the same tx without mutating inputs", async () => {
    const share = createOriginalCashClosureShare(), tx = {} as Tx;
    const receiptIds = ["receipt-b", "receipt-a"], subscriptionIds = ["parent-b", "parent-a"];
    await expect(Promise.all([
      controlledCashFinancialHistoryShared(tx, receiptIds, subscriptionIds, share),
      controlledCashFinancialHistoryShared(tx, [...receiptIds].reverse(), [...subscriptionIds].reverse(), share),
    ])).rejects.toThrow("controlled stop");
    expect(controlledProviderWitnesses).toHaveBeenCalledTimes(1);
    expect(receiptIds).toEqual(["receipt-b", "receipt-a"]);
    expect(subscriptionIds).toEqual(["parent-b", "parent-a"]);

    await expect(controlledCashFinancialHistoryShared(tx, ["receipt-a"], subscriptionIds, share)).rejects.toThrow("controlled stop");
    expect(controlledProviderWitnesses).toHaveBeenCalledTimes(2);
    await expect(controlledCashFinancialHistoryShared(tx, receiptIds, ["parent-a"], share)).rejects.toThrow("controlled stop");
    expect(controlledProviderWitnesses).toHaveBeenCalledTimes(3);
    await expect(controlledCashFinancialHistoryShared({} as Tx, receiptIds, subscriptionIds, share)).rejects.toThrow("controlled stop");
    expect(controlledProviderWitnesses).toHaveBeenCalledTimes(4);
    await expect(controlledCashFinancialHistoryShared(tx, receiptIds, subscriptionIds, createOriginalCashClosureShare())).rejects.toThrow("controlled stop");
    expect(controlledProviderWitnesses).toHaveBeenCalledTimes(5);
    await expect(controlledCashFinancialHistoryShared(tx, receiptIds, subscriptionIds)).rejects.toThrow("controlled stop");
    expect(controlledProviderWitnesses).toHaveBeenCalledTimes(6);
  });

  it("keeps the final controlled-history fence on a fresh direct read", () => {
    const source = readFileSync(new URL("../../src/modules/invoicing/original-cash-principal.ts", import.meta.url), "utf8");
    expect(source).toContain("const [controlled,witness,history] = await Promise.all([");
    expect(source).toContain("controlledCashFinancialHistoryShared(ctx.tx, receiptIds, controlledParents.map(row => row.id), share, composition)");
    expect(source).toContain(":controlledCashFinancialHistory(ctx.tx, receiptIds, controlledParents.map(row => row.id))]);");
  });

  it("reverses only the ordered witness-batching source deltas", () => {
    for (const file of witnessBatch.files) {
      let source = restoreRowHashLedgerSource(file.path, readFileSync(new URL(`../../${file.path}`, import.meta.url), "utf8"));
      const latest = publicBoundary.files.find(row => row.path === file.path);
      if (latest) {
        expect(createHash("sha256").update(source).digest("hex")).toBe(latest.afterSha256);
        for (const delta of [...latest.edits].reverse()) {
          expect(source.split(delta.after)).toHaveLength(2);
          source = source.replace(delta.after, () => delta.before);
        }
        expect(createHash("sha256").update(source).digest("hex")).toBe(latest.beforeSha256);
      }
      expect(createHash("sha256").update(source).digest("hex")).toBe(file.afterSha256);
      for (const delta of [...file.finiteDelta].reverse()) {
        expect(source.split(delta.after)).toHaveLength(2);
        source = source.replace(delta.after, () => delta.before);
      }
      expect(createHash("sha256").update(source).digest("hex")).toBe(file.beforeSha256);
    }
  });
});
