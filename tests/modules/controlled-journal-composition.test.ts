// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/core/service";

const mocks = vi.hoisted(() => ({
 journal: vi.fn(async (_tx: Tx, resourceId: string) => ({ resourceId, certificate: resourceId })),
 certificate: vi.fn((history: { certificate: string }) => history.certificate),
}));
vi.mock("@/modules/subscriptions/controlled-provider-proof", () => ({
 controlledProviderJournal: mocks.journal,
 controlledJournalPgCertificate: mocks.certificate,
}));

import { createControlledJournalComposition, finishControlledJournalComposition, readComposedControlledProviderJournal } from "@/modules/subscriptions/controlled-provider-journal-composition";

describe("evaluation-local controlled journal composition", () => {
 it("coalesces only the same resource and scope, then freshly certifies every used resource", async () => {
  const tx = {} as Tx, scope = createControlledJournalComposition();
  const [first, second, other] = await Promise.all([
   readComposedControlledProviderJournal(tx, "a", scope),
   readComposedControlledProviderJournal(tx, "a", scope),
   readComposedControlledProviderJournal(tx, "b", scope),
  ]);
  expect(first).toBe(second); expect(other).not.toBe(first); expect(mocks.journal).toHaveBeenCalledTimes(2);
  await finishControlledJournalComposition(tx, scope); expect(mocks.journal).toHaveBeenCalledTimes(4);
 });

 it("refuses a changed full-content certificate", async () => {
  const tx = {} as Tx, scope = createControlledJournalComposition();
  await readComposedControlledProviderJournal(tx, "a", scope);
  mocks.journal.mockResolvedValueOnce({ resourceId: "a", certificate: "changed" });
  await expect(finishControlledJournalComposition(tx, scope)).rejects.toMatchObject({ code: "conflict" });
 });
});
