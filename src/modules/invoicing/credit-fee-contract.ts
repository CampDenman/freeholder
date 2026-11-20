// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: shared fee schema stays independent of financial services.
import {z} from "zod";
export const feeCollectionState = z.enum(["not_due", "owed", "recorded_remitted", "verified_collected", "review"]);
export type FeeCollectionState = z.infer<typeof feeCollectionState>;
export const creditFeeAllocation = z.object({ feeObligationMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), provenCollectedMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  collectionState: feeCollectionState, sourceCollectionState: feeCollectionState.optional(), unexpectedFee: z.boolean(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) });
