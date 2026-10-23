// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: the time a visitor picked on /book, carried in the address.

/**
 * The open slot the address names, or undefined. `calendar` and `at` come
 * from the URL, so anybody can type anything there; only a slot the resolver
 * actually offered for this service, date and party size is ever treated as
 * chosen. A made-up calendar or a time that is not open simply shows the
 * list of times again, and the reservation itself is re-checked by
 * `catalog.bookService` against live availability.
 */
export function chosenSlot<T extends { calendarId: string; startsAt: Date }>(
  slots: readonly T[],
  calendar: string | undefined,
  at: string | undefined,
): T | undefined {
  if (!calendar || !at) return undefined;
  return slots.find((slot) => slot.calendarId === calendar && slot.startsAt.toISOString() === at);
}
