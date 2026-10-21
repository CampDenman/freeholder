// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who may see a member's listing (MASTER.md §44.9, C12.29).
//
// The members module decides which listings this viewer must not see (for
// example adult listings for minors, visitors and anyone who has not opted
// in); the catalog only asks, everywhere a product can be found or bought.
// With nothing registered, every listing is visible.
import type { ServiceContext } from "@/core/service";

export type ListingViewGate = (ctx: ServiceContext, productIds: string[]) => Promise<Set<string>>;
let gate: ListingViewGate | null = null;

export function registerListingViewGate(next: ListingViewGate): void {
  gate = next;
}

/** The ids, among these, that the current viewer must not see. */
export async function hiddenListings(ctx: ServiceContext, productIds: string[]): Promise<Set<string>> {
  if (!gate || productIds.length === 0) return new Set();
  return gate(ctx, productIds);
}
