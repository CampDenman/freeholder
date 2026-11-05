// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export const MAX_DAYS: number;
export function previewToken(key: string, expiresAt: number): string;
export function previewLink(
  origin: string,
  key: string | undefined,
  options?: { days?: number; now?: number; next?: string },
): { url: string; expiresAt: number };
