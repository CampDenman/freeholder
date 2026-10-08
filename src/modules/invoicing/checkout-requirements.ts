// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Modules may require explicit recurring-payment consent at invoice checkout.
import type { ServiceContext } from "@/core/service";
const requirements = new Map<string, (ctx: ServiceContext, sourceId: string) => Promise<boolean>>();
export function registerCheckoutRequirement(source: string, required: (ctx: ServiceContext, sourceId: string) => Promise<boolean>) {
  requirements.set(source, required);
}
export async function requiresSavedMethod(ctx: ServiceContext, invoice: { sourceType: string | null; sourceId: string | null }): Promise<boolean> {
  const check = invoice.sourceType ? requirements.get(invoice.sourceType) : undefined;
  return check && invoice.sourceId ? check(ctx, invoice.sourceId) : false;
}

const eligibility = new Map<string, (ctx: ServiceContext, sourceId: string) => Promise<boolean>>();
export function registerCheckoutEligibility(source: string, allowed: (ctx: ServiceContext, sourceId: string) => Promise<boolean>) { eligibility.set(source, allowed); }
export async function customerCheckoutAllowed(ctx: ServiceContext, invoice: { sourceType: string | null; sourceId: string | null }): Promise<boolean> {
  const check = invoice.sourceType ? eligibility.get(invoice.sourceType) : undefined;
  return check && invoice.sourceId ? check(ctx, invoice.sourceId) : true;
}
