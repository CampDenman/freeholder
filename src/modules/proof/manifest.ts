// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party proof that a plugin is just a module (C2.23, MASTER.md §24).
//
// It registers a block schema, renderer and editor fields, a migration, a
// sitemap source and a seed block. The editor is not imported — the palette
// is derived from the block's Zod schema.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "proof",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  seo: { sitemapSources: ["proof.publishedPaths"] },
});
