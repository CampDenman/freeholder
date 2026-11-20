// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: private original-return lineage contract.
import { z } from "zod";
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const merchantReturnFeeSourceResult = z.object({ hasOrder: z.boolean(), incomplete: z.boolean(), returns: z.array(z.object({
  returnId: z.uuid(), creditNoteId: z.uuid(), completed: z.boolean(), items: z.array(z.object({ invoiceLineId: z.uuid(), quantityMicros: minor })),
  parts: z.array(z.object({ id: z.uuid(), paymentId: z.uuid(), amountMinor: minor, refundIds: z.array(z.uuid()) })),
})).max(5000) });
