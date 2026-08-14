// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { SmsAdapter } from "./types";

export function createNoSms(): SmsAdapter {
  const message = "SMS delivery is not configured.";
  return {
    channel: "sms",
    id: "none",
    available: false,
    status: {
      family: "sms",
      channel: "sms",
      provider: "none",
      id: "none",
      available: false,
      message,
    },
    async send() { return { providerRef: null, delivers: false, reason: message }; },
    verifyWebhook() { return Promise.reject(unavailable("sms", "none", message)); },
  };
}
