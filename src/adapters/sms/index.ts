// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoSms } from "./none";
import type { SmsAdapter } from "./types";

export * from "./types";
export { createNoSms } from "./none";
export const smsAdapters = new AdapterRegistry<SmsAdapter>("sms", [createNoSms()]);
