// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38/C1.08: immutable paid effects follow exact validated target invoices.
import { ServiceError, type Tx } from "@/core/service";
import { controlledPaidPeriodWitnesses, exportControlledPaidPeriodHistory } from "@/modules/subscriptions/controlled-provider-paid-period-witnesses";
import { merchantTaxDigest } from "./merchant-tax-store";

type PaidTargetGraph = {
  quotes: readonly { id: string; profileId: string }[];
  collections: readonly { id: string; quoteId: string; invoiceId: string | null }[];
};
type PaidScope = { profileId?: string; targets: Array<{ collectionId: string; invoiceId: string }> };
type PaidEntry = Awaited<ReturnType<typeof controlledPaidPeriodWitnesses>>["entries"][number];
function refuse(): never { throw new ServiceError("conflict", "Restore the exact complete paid-period target, original profile and immutable financial history before review or export."); }
/** No profile/subscription OR selector is passed to the underlying reader.
 * Historical invoiced targets remain selected when a later target is cashless.
 * Invoice equality never authorizes a second collection or another merchant. */
export function controlledPaidTargetScopes(scope: { profileIds?: readonly string[] }, targets: PaidTargetGraph): PaidScope[] {
  const quotes = new Map<string, string>();
  for (const row of targets.quotes) {
    const prior = quotes.get(row.id); if (prior !== undefined && prior !== row.profileId) refuse(); quotes.set(row.id, row.profileId);
  }
  const profiles = [...new Set(scope.profileIds ?? [])].sort(), groups = new Map<string, PaidScope>();
  const collections = new Map<string, string>(), invoices = new Map<string, string>();
  for (const row of targets.collections) {
    const profileId = quotes.get(row.quoteId); if (!profileId) refuse();
    const identity = merchantTaxDigest(row), prior = collections.get(row.id); if (prior && prior !== identity) refuse(); collections.set(row.id, identity);
    if (profiles.length && !profiles.includes(profileId) || !row.invoiceId) continue;
    const owner = invoices.get(row.invoiceId); if (owner && owner !== row.id) refuse(); invoices.set(row.invoiceId, row.id);
    const key = profiles.length ? profileId : "", group = groups.get(key) ?? { ...(profiles.length ? { profileId } : {}), targets: [] };
    if (!group.targets.some(selected => selected.collectionId === row.id)) group.targets.push({ collectionId: row.id, invoiceId: row.invoiceId });
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => ({ ...group, targets: group.targets.sort((a, b) => a.collectionId.localeCompare(b.collectionId)) }));
}
export function mergeControlledPaidEntries(groups: readonly (readonly PaidEntry[])[], existingRows = 0): PaidEntry[] {
  if (!Number.isSafeInteger(existingRows) || existingRows < 0 || existingRows > 5000) refuse();
  const entries = new Map<string, PaidEntry>();
  for (const rows of groups) for (const row of rows) {
    const key = `${row.table}:${row.id}`, prior = entries.get(key); if (prior && merchantTaxDigest(prior) !== merchantTaxDigest(row)) refuse(); entries.set(key, row);
    if (existingRows + entries.size > 5000) refuse();
  }
  return [...entries.values()].sort((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
}
function assertScope(entries: readonly PaidEntry[], scope: PaidScope): void {
  for (const row of entries) if (!scope.targets.some(target => target.collectionId === row.parents.collectionId && target.invoiceId === row.parents.invoiceId)
    || scope.profileId !== undefined && row.parents.profileId !== scope.profileId) refuse();
}
export async function controlledPaidFinancialWitness(tx: Tx, scope: { profileIds?: readonly string[] }, targets: PaidTargetGraph) {
  const scopes = controlledPaidTargetScopes(scope, targets), groups: PaidEntry[][] = [];
  for (const selectedScope of scopes) {
    const selected = await controlledPaidPeriodWitnesses(tx, { invoiceIds: selectedScope.targets.map(row => row.invoiceId) });
    if (selected.incomplete) refuse(); assertScope(selected.entries, selectedScope); groups.push(selected.entries);
  }
  return { entries: mergeControlledPaidEntries(groups), scopes };
}
export type ControlledPaidFinancialHistory = Awaited<ReturnType<typeof controlledPaidFinancialWitness>>;
export async function exportControlledPaidFinancialHistory(tx: Tx, selected: ControlledPaidFinancialHistory, options: { merchant: boolean; existingRows: number }) {
  mergeControlledPaidEntries([selected.entries], options.existingRows);
  const groups: PaidEntry[][] = [], receipts = new Map<string, Awaited<ReturnType<typeof exportControlledPaidPeriodHistory>>["receipts"][number]>();
  for (const scope of selected.scopes) {
    const actual = await exportControlledPaidPeriodHistory(tx, { invoiceIds: scope.targets.map(row => row.invoiceId) }, options);
    assertScope(actual.selected.entries, scope); groups.push(actual.selected.entries);
    for (const row of actual.receipts) { const prior = receipts.get(row.id); if (prior && merchantTaxDigest(prior) !== merchantTaxDigest(row)) refuse(); receipts.set(row.id, row); }
  }
  const entries = mergeControlledPaidEntries(groups, options.existingRows);
  if (merchantTaxDigest(entries) !== merchantTaxDigest(selected.entries) || receipts.size !== entries.length) refuse();
  return { receipts: [...receipts.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
