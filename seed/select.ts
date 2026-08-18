// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which seed pack this instance installs.
//
// Photography remains the default so contributors and the SEO gate keep the
// site they already prove. Law Firm is opt-in via FREEHOLDER_EDITION=law-firm
// (WeVibeSites sets that when it provisions an edition site).
import { env } from "@/core/env";
import * as photography from "./demo/content";
import * as lawFirm from "./law-firm/content";

export type SeedPack = typeof photography | typeof lawFirm;

export function selectedSeedPack(): SeedPack {
  return env().FREEHOLDER_EDITION === "law-firm" ? lawFirm : photography;
}
