// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.04/C6.07/C6.08: keep live-clock booking fixtures safely in the future.
const fixtureDay = new Date(Date.now() + 14 * 86_400_000);
fixtureDay.setUTCHours(0, 0, 0, 0);

export function bookingTime(hour: number, minute = 0): string {
  const instant = new Date(fixtureDay);
  instant.setUTCHours(hour, minute, 0, 0);
  return instant.toISOString();
}
