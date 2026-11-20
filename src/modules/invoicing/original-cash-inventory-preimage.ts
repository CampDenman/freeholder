// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: capture actual selected history encodings without renaming their domains.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalInventoryPreimageEntry, type OriginalInventoryPreimageEntry } from "./original-cash-inventory-causal-contract";
const uuid = z.uuid();
function refuse(): never { throw new ServiceError("conflict", "Restore every exact bounded original inventory identity and hash domain before admitting or comparing this read."); }
/** Logical feedback namespaces and event subsets retain their complete bytes in
 * contribution hashes, while the budget counts their real underlying row once. */
export function originalInventoryPhysicalIdentity(table: string, id: string) {
  if (table === "original_cash_feedback" || table === "legacy_bank_feedback") {
    const pieces = id.split(":");
    if (pieces.length === 2 && (/^[a-f0-9]{64}$/.test(pieces[0] ?? "") || uuid.safeParse(pieces[0]).success) && uuid.safeParse(pieces[1]).success)
      return { table: "legacy_bank_feedback", id: uuid.parse(pieces[1]) };
  }
  if (table.startsWith("money_state_events.")) table = "money_state_events";
  if (!uuid.safeParse(id).success || !/^[a-z_][a-z0-9_]*$/.test(table)) refuse();
  return { table, id };
}
export function originalInventoryPreimageCollector() {
  const entries = new Map<string, { table: string; id: string; contributions: Map<string, string> }>();
  return {
    add(table: string, id: string, contribution: string, value: unknown) {
      const actual = originalInventoryPhysicalIdentity(table, id), key = `${actual.table}:${actual.id}`;
      const entry = entries.get(key) ?? { ...actual, contributions: new Map<string, string>() };
      const digest = merchantTaxDigest(value), previous = entry.contributions.get(contribution);
      if (previous && previous !== digest) refuse();
      entry.contributions.set(contribution, digest); entries.set(key, entry);
      if (entries.size > 5000) refuse();
    },
    finish(): OriginalInventoryPreimageEntry[] {
      return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => originalInventoryPreimageEntry.parse({ table: row.table, id: row.id,
        fingerprints: { history_canonical: merchantTaxDigest([...row.contributions].sort(([a], [b]) => a.localeCompare(b))) } }));
    },
  };
}
export function originalInventoryPreimagesEqual(before: readonly OriginalInventoryPreimageEntry[], after: readonly OriginalInventoryPreimageEntry[]) {
  const ordered = (rows: readonly OriginalInventoryPreimageEntry[]) => [...rows].sort((a,b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
  return merchantTaxDigest(ordered(before)) === merchantTaxDigest(ordered(after));
}
