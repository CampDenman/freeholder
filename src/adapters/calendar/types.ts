// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider-neutral two-way calendar boundary (MASTER.md §12, C5.01).

import type { AdapterStatus, RawProviderRequest } from "../types";

export interface CalendarEventInput {
  idempotencyKey: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  attendees: readonly { email: string; name?: string }[];
  location?: string;
}

export interface CalendarEventRecord extends CalendarEventInput {
  providerRef: string;
  etag?: string;
  status: "confirmed" | "cancelled";
}

export interface BusyWindow {
  startsAt: string;
  endsAt: string;
}

export interface CalendarProviderEvent {
  id: string;
  providerRef: string;
  kind: "created" | "updated" | "cancelled";
  occurredAt: string;
}

export interface CalendarAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  listBusy(input: { calendarRef: string; startsAt: string; endsAt: string }): Promise<readonly BusyWindow[]>;
  upsertEvent(input: CalendarEventInput & { providerRef?: string }): Promise<CalendarEventRecord>;
  cancelEvent(input: { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly CalendarProviderEvent[]>;
}
