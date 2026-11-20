// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: legacy unknown platform ownership never becomes today's key.
import { eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function originalProviderPlatform(column: AnyPgColumn, platformId: string | null | undefined) {
  return platformId ? eq(column, platformId) : isNull(column);
}
