// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { SocialAdapter } from "./types";

export function createNoSocial(): SocialAdapter {
  const message = "Social publishing is not configured.";
  const failure = () => Promise.reject(unavailable("social", "none", message));
  const empty = {
    read: false,
    respond: false,
    publish: false,
    extras: [] as const,
  };
  return {
    id: "none",
    label: "No network",
    status: { family: "social", id: "none", available: false, message },
    declaredCapabilities: empty,
    pkce: false,
    authorizationUrl: () => {
      throw unavailable("social", "none", message);
    },
    exchangeCode: failure,
    identity: failure,
    capabilities: () => empty,
    health: failure,
    listOwnedPosts: failure,
    listInteractions: failure,
    listReviews: failure,
    pushHours: failure,
    publish: failure,
    remove: failure,
    verifyWebhook: failure,
  };
}
