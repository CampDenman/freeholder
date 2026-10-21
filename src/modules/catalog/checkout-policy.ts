// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.21/C5.22: one instance-owned checkout promise, snapshotted on each order.
import { createHash } from "node:crypto";
import { z } from "zod";
import { getModuleConfig } from "@/core/settings/service";
import type { ServiceContext } from "@/core/service";
import { ServiceError } from "@/core/service";

export const checkoutPaymentSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("full") }),
    z.object({
      mode: z.literal("milestones"),
      currency: z.string().regex(/^[A-Z]{3}$/),
      firstPayment: z.discriminatedUnion("type", [
        z.object({ type: z.literal("fixed"), amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
        z.object({ type: z.literal("percent"), sharePpm: z.number().int().positive().max(1_000_000) }),
      ]),
      milestones: z.array(z.object({
        label: z.string().trim().min(1).max(200),
        sharePpm: z.number().int().positive().max(1_000_000),
      })).min(1).max(12),
    }),
  ]).refine((value) => value.mode === "full" || value.milestones.reduce((sum, row) => sum + row.sharePpm, 0) === 1_000_000,
    "Milestone shares must add up to 100%.");

export const catalogSettingsSchema = z.object({
  checkoutPayment: checkoutPaymentSchema.default({ mode: "full" }),
  checkoutTerms: z.object({
    version: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(50_000),
    href: z.string().max(500).regex(/^\/(?!\/)[^\s]*$/, "Use a same-site terms path.").optional(),
  }).nullable().default(null),
}).refine((value) => value.checkoutPayment.mode === "full" || value.checkoutTerms !== null,
  "Milestone checkout requires published purchase terms.");

export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;

export function checkoutTermsHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function termsSnapshot(terms: NonNullable<CatalogSettings["checkoutTerms"]>, acceptedAt: Date) {
  return {
    ...terms,
    sha256: checkoutTermsHash(terms.body),
    acceptedAt: acceptedAt.toISOString(),
  };
}

export async function checkoutSettings(ctx: ServiceContext): Promise<CatalogSettings> {
  const config = await ctx.callAsSystem(getModuleConfig, { module: "catalog" });
  return catalogSettingsSchema.parse(config);
}

export function paymentMilestones(totalMinor: number, policy: Extract<CatalogSettings["checkoutPayment"], { mode: "milestones" }>) {
  let allocated = 0;
  const stages = policy.milestones.map((item, position) => {
    const amountMinor = position === policy.milestones.length - 1
      ? totalMinor - allocated
      : Math.floor(totalMinor * item.sharePpm / 1_000_000);
    allocated += amountMinor;
    return { label: item.label, amountMinor };
  });
  const firstMinor = policy.firstPayment.type === "fixed"
    ? policy.firstPayment.amountMinor
    : Math.floor(totalMinor * policy.firstPayment.sharePpm / 1_000_000);
  if (firstMinor < 1 || totalMinor < firstMinor || stages[0]!.amountMinor < firstMinor) {
    throw new ServiceError("validation", "The first milestone must cover the configured first payment.");
  }
  return [
    { label: policy.firstPayment.type === "percent" && firstMinor === stages[0]!.amountMinor
      ? stages[0]!.label : `First payment toward ${stages[0]!.label}`, amountMinor: firstMinor },
    ...stages.map((stage, index) => ({
      label: index === 0 ? `${stage.label} balance` : stage.label,
      amountMinor: index === 0 ? stage.amountMinor - firstMinor : stage.amountMinor,
    })).filter((stage) => stage.amountMinor > 0),
  ];
}
