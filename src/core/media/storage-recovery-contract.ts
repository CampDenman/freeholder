// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {z} from "zod";
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const storageRecoveryConfirmation=z.object({id:z.uuid(),expectedUpdatedAt:z.iso.datetime(),originalNamespace:digest,
 stopDrainId:z.uuid().optional(),originalKey:z.string().min(1).max(2048).optional(),outcome:z.enum(["applied","not_applied"]),sha256:digest.optional(),bytes:z.number().int().min(0).max(5*1024**3).optional(),
 providerFinalReference:z.string().trim().min(8).max(300),providerEvidence:z.string().trim().min(20).max(2000),stoppedWriterEvidence:z.string().trim().min(20).max(2000),confirmation:z.literal("ORIGINAL STORAGE OUTCOME CONFIRMED")});
export type StorageRecoveryConfirmation=z.infer<typeof storageRecoveryConfirmation>;
