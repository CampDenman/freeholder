// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { SocialAdapter } from "./types";

export function createNoSocial(): SocialAdapter {
  const message = "Social publishing is not configured.";
  const failure = () => Promise.reject(unavailable("social", "none", message));
  return {
    id: "none",
    status: { family: "social", id: "none", available: false, message },
    publish: failure,
    remove: failure,
    verifyWebhook: failure,
  };
}
