// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared pieces of service output schemas (C3.01).
//
// Handler returns are validated against these in development and tests.
// `row` is loose so a new column on a drizzle row does not 500 an instance
// before the contract is updated; the named fields are the public shape.
import { z } from "zod";

export const uuid = z.string().uuid();
export const timestamp = z.date();
export const okResult = z.object({ ok: z.literal(true) });

export function row<T extends z.ZodRawShape>(shape: T) {
  return z.looseObject(shape);
}

export function listed<Item extends z.ZodType>(item: Item) {
  return z.array(item);
}
