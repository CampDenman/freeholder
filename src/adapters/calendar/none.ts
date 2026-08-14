// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { CalendarAdapter } from "./types";

export function createNoCalendar(): CalendarAdapter {
  const message = "Calendar synchronization is not configured.";
  const failure = () => Promise.reject(unavailable("calendar", "none", message));
  return {
    id: "none",
    status: { family: "calendar", id: "none", available: false, message },
    listBusy: failure,
    upsertEvent: failure,
    cancelEvent: failure,
    verifyWebhook: failure,
  };
}
