// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoAi } from "./none";
import type { AiAdapter } from "./types";

export * from "./types";
export { createNoAi } from "./none";
export const aiAdapters = new AdapterRegistry<AiAdapter>("ai", [createNoAi()]);
