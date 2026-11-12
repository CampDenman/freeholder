// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/** A caller's observed review version, never permission to access the run. */
export const importGraphVersionSchema = z.object({
  generation: z.uuid(), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  planRevision: z.number().int().positive(),
});
export type ImportGraphVersion = z.infer<typeof importGraphVersionSchema>;
