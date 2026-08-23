// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which seed pack this instance installs.
//
// Photography remains the default so contributors and the SEO gate keep the
// site they already prove. Industry editions are opt-in via FREEHOLDER_EDITION
// (WeVibeSites sets that when it provisions an edition site).
import { env } from "@/core/env";
import * as photography from "./demo/content";
import * as lawFirm from "./law-firm/content";
import * as fishingCharter from "./fishing-charter/content";

export type SeedPack = typeof photography | typeof lawFirm | typeof fishingCharter;

export function selectedSeedPack(): SeedPack {
  const edition = env().FREEHOLDER_EDITION;
  if (edition === "law-firm") return lawFirm;
  if (edition === "fishing-charter") return fishingCharter;
  return photography;
}
