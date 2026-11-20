// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: private mandatory financial evidence never becomes a public DTO field.
import {z} from "zod";
import {controlledChangedPriceReview,controlledPeriodReview} from "./controlled-provider-collection-contract";
import {atomicCreditFeeDeclaration} from "@/modules/invoicing/atomic-credit-fee-declaration-contract";
export const controlledStoredProrationReview=controlledChangedPriceReview.extend({atomicCreditFeeDeclaration:atomicCreditFeeDeclaration.optional()}).strict();
export const controlledStoredTargetReview=z.discriminatedUnion("kind",[controlledStoredProrationReview,controlledPeriodReview]);
export type ControlledStoredTargetReview=z.infer<typeof controlledStoredTargetReview>;
