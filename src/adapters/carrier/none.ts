// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { CarrierAdapter } from "./types";

export function createNoCarrier(): CarrierAdapter {
  const message = "Live carrier rates and labels are not configured.";
  const failure = () => Promise.reject(unavailable("carrier", "none", message));
  return {
    id: "none",
    status: { family: "carrier", id: "none", available: false, message },
    quote: failure,
    buyLabel: failure,
    voidLabel: failure,
    verifyWebhook: failure,
  };
}
