// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Swappable carrier seam for notification channels (MASTER.md §12, C1.15).
// Consent and preferences belong to core; a vendor only transports the
// already-authorized message it receives here.
export type ExternalNotificationChannel = "sms" | "push";

export interface OutboundNotification {
  to: string;
  title: string;
  body: string;
  href?: string;
  /** Stable provider idempotency/correlation value. */
  deliveryId: string;
}

export interface NotificationAdapterResult {
  providerRef: string | null;
  delivers: boolean;
  reason?: string;
}

export interface NotificationAdapterStatus {
  channel: ExternalNotificationChannel;
  provider: string;
  available: boolean;
  message: string;
}

export interface NotificationChannelAdapter {
  readonly channel: ExternalNotificationChannel;
  readonly id: string;
  readonly available: boolean;
  readonly status: NotificationAdapterStatus;
  send(message: OutboundNotification): Promise<NotificationAdapterResult>;
}
