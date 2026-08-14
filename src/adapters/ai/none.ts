// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { AiAdapter } from "./types";

export function createNoAi(): AiAdapter {
  const message = "AI generation is not configured.";
  return {
    id: "none",
    status: { family: "ai", id: "none", available: false, message },
    generate() { return Promise.reject(unavailable("ai", "none", message)); },
  };
}
