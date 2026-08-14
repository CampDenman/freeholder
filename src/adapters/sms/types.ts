// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SMS carrier seam. Consent and quiet-hour decisions remain in core.

import type { NotificationChannelAdapter, OutboundNotification } from "../notifications/types";
import type { AdapterStatus, RawProviderRequest } from "../types";

export interface SmsProviderEvent {
  id: string;
  kind: "delivered" | "failed" | "received";
  providerRef: string;
  from?: string;
  to?: string;
  body?: string;
  occurredAt: string;
}

export interface SmsAdapter extends NotificationChannelAdapter {
  readonly channel: "sms";
  readonly status: NotificationChannelAdapter["status"] & AdapterStatus;
  send(message: OutboundNotification): ReturnType<NotificationChannelAdapter["send"]>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly SmsProviderEvent[]>;
}
