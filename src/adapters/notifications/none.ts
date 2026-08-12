// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ExternalNotificationChannel,
  NotificationChannelAdapter,
} from "@/adapters/notifications/types";

/** Honest disabled adapter: records a skip and never makes a network call. */
export function createUnavailableNotificationAdapter(
  channel: ExternalNotificationChannel,
  selectedProvider = "none",
): NotificationChannelAdapter {
  const future = channel === "sms" ? "C7.10" : "C10.14";
  const message =
    selectedProvider === "none"
      ? `${channel.toUpperCase()} delivery is not configured.`
      : `${selectedProvider} is selected, but its production ${channel.toUpperCase()} adapter is not installed yet (${future}).`;
  return {
    channel,
    id: selectedProvider,
    available: false,
    status: { channel, provider: selectedProvider, available: false, message },
    async send() {
      return { providerRef: null, delivers: false, reason: message };
    },
  };
}
