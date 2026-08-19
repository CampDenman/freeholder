// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party proof that a plugin is just a module (C2.23, C3.08, MASTER.md §24).
//
// It registers a block schema, renderer and editor fields, a migration, a
// sitemap source and a seed block. The editor is not imported — the palette
// is derived from the block's Zod schema. `definePlugin` adds the version,
// permission and compatibility fields the install path will need (C3.09).
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "proof",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["cms:view"],
  requires: ["core", "cms"],
  migrations: ["0073_plain_lilandra.sql"],
  capabilities: { blocks: true },
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  seo: { sitemapSources: ["proof.publishedPaths"] },
});
