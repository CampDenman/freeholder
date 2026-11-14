// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Safe exact original admission shared by the immediate service and durable job.
import {z} from "zod";
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const originalMultipartRetirementAdmission=z.object({resourceId:z.uuid(),uploadId:z.uuid(),keyDigest:digest,operationId:z.uuid(),inventoryId:z.uuid(),proofDigest:digest}).strict();
export type OriginalMultipartRetirementAdmission=z.infer<typeof originalMultipartRetirementAdmission>;
export const ORIGINAL_MULTIPART_RETIREMENT_JOB="core.sealOriginalMultipartRetirement";
export function originalMultipartRetirementJobKey(admission:OriginalMultipartRetirementAdmission):string{return`original-retirement-seal:${admission.operationId}:${admission.inventoryId}:${admission.proofDigest}`;}
