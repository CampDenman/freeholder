// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: strict lookup ABI only; no runtime money/proof/registration dependencies.
import { z } from "zod";
export const CONTROLLED_CASH_BATCH_MARKER = "freeholder.controlled_cash_application_batch_v1";
export const controlledCashBatchPointer = z.object({ batchId: z.uuid(), collectionId: z.uuid(), receiptId: z.uuid(), admissionDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
