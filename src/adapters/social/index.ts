// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoSocial } from "./none";
import type { SocialAdapter } from "./types";

export * from "./types";
export { createNoSocial } from "./none";
export const socialAdapters = new AdapterRegistry<SocialAdapter>("social", [
  createNoSocial(),
]);
