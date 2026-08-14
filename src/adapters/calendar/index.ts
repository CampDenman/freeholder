// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoCalendar } from "./none";
import type { CalendarAdapter } from "./types";

export * from "./types";
export { createNoCalendar } from "./none";
export const calendarAdapters = new AdapterRegistry<CalendarAdapter>("calendar", [
  createNoCalendar(),
]);
