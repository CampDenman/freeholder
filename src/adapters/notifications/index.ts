// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import config from "../../../freeholder.config";
import { createUnavailableNotificationAdapter } from "@/adapters/notifications/none";

/**
 * C1.15 owns the fanout contract. Carrier implementations arrive at their
 * compliance checkpoints; until then these adapters leave explicit `skipped`
 * evidence instead of pretending a message went somewhere.
 */
export const smsNotifications = createUnavailableNotificationAdapter(
  "sms",
  config.adapters.sms,
);
export const pushNotifications = createUnavailableNotificationAdapter("push");

export function notificationAdapterStatus() {
  return [smsNotifications.status, pushNotifications.status] as const;
}

export type {
  ExternalNotificationChannel,
  NotificationAdapterResult,
  NotificationAdapterStatus,
  NotificationChannelAdapter,
  OutboundNotification,
} from "@/adapters/notifications/types";
