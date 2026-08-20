// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One rule for optional reads on admin pages: a domain refusal is an
// absence, an infrastructure failure is an error.
import { ServiceError } from "@/core/service";

/**
 * `.catch(() => null)` on a page read renders a database outage as "this
 * product has no variants" or "this invoice has no customer" — a plausible
 * lie the owner then acts on. A ServiceError (not found, permission) is a
 * legitimate domain answer and becomes null; anything else propagates to the
 * error boundary, because failing visibly is the honest state (F04).
 */
export async function domainOrNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ServiceError) return null;
    throw error;
  }
}
