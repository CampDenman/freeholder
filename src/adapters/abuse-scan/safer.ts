// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30: Thorn Safer. Safer's API reference is given to customers when they
// sign up, so its requests are not written here from guesswork: until a site
// has that agreement and the adapter is completed against Safer's documents,
// this scanner reports itself as not configured and never claims to scan.
import type { AbuseScanner } from "./types";

export const saferScanner: AbuseScanner = {
  id: "safer",
  missing: () => ["Thorn Safer agreement and API reference (completed adapter)"],
  async match() {
    throw new Error("The Thorn Safer adapter is not complete; it needs Safer's API reference.");
  },
};
