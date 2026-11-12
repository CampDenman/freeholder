// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: source formats share graph budgets, not fabricated source entities.
import { z } from "zod";
import { archiveGraphEntrySchema } from "./archive-graph-contract";
import { archiveIndexCursorSchema } from "./archive-index";
import { wxrEntryMetadataSchema, wxrHeaderMetadataSchema, wxrIndexCursorSchema, wxrIndexedEntrySchema } from "./wxr-index";

export const archiveGraphHeaderSchema = z.object({
  format: z.literal("archive-zip"), origin: z.string().url().max(8_192), root: z.string().max(1_024),
  directoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.number().int().min(1).max(10_000), directoryEntries: z.number().int().min(1).max(10_000),
  expandedBytes: z.number().int().min(0).max(100 * 1024 * 1024),
}).strict();
// A malformed explicit format must never fall through a permissive older
// WordPress schema and lose the original file facts by object-key stripping.
export const sourceGraphCursorSchema = z.union([
  archiveIndexCursorSchema, wxrIndexCursorSchema.extend({ format: z.never().optional() }),
]);
export const sourceGraphHeaderSchema = z.union([
  archiveGraphHeaderSchema, wxrHeaderMetadataSchema.extend({ format: z.never().optional() }),
]);
export const sourceGraphEntrySchema = z.union([
  archiveGraphEntrySchema,
  wxrIndexedEntrySchema.extend({ metadata: wxrEntryMetadataSchema.extend({ format: z.never().optional() }) }),
]);
export type SourceGraphCursor = z.infer<typeof sourceGraphCursorSchema>;
