// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: only exact application projection fields have an immutable preimage.
import {z} from "zod";
export const atomicCreditInvoiceProjection=z.object({invoiceId:z.uuid(),creditedMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 status:z.enum(["draft","sent","viewed","partially_paid","paid","overdue","void","refunded"]),paidAt:z.iso.datetime().nullable(),updatedAt:z.iso.datetime()}).strict();
export type AtomicCreditInvoiceProjection=z.infer<typeof atomicCreditInvoiceProjection>;
