// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { env } from "@/core/env";
import { createNoSms } from "./none";
import { createTwilioSms } from "./twilio";
import type { SmsAdapter } from "./types";

export * from "./types";
export { createNoSms } from "./none";
export { createTwilioSms } from "./twilio";

/**
 * Every SMS adapter, with the unconfigured one always present.
 *
 * `none` is not a placeholder to be removed once a real provider is set up: it
 * is what an instance with no SMS credentials resolves to, and it refuses
 * clearly instead of throwing somewhere further in. Secrets come from the
 * environment (§17); everything else about a number lives in the database.
 */
export const smsAdapters = new AdapterRegistry<SmsAdapter>("sms", [
  createNoSms(),
  createTwilioSms({
    accountSid: env().TWILIO_ACCOUNT_SID,
    authToken: env().TWILIO_AUTH_TOKEN,
    from: env().TWILIO_FROM_NUMBER,
    webhookUrl: env().TWILIO_WEBHOOK_URL,
  }),
]);
