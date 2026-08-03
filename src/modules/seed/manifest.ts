// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The seed module (MASTER.md §3, §11, §15.2, §25).
//
// A module that owns no tables and mounts no routes, which is worth having as
// a shape: it exists to write other modules' data through their own services,
// so `requires: ["cms"]` is doing real work — the topo-sort guarantees the
// block registry is populated before anything tries to validate a block tree
// against it.
//
// The demo content itself lives in `seed/` (§10's layout), not here. That
// split is deliberate: the content is data a contributor may want to edit
// without reading any code, and the service is code that must never contain a
// page's copy.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "seed",
  version: "0.1.0",
  requires: ["core", "cms"],
  services: () => import("./service"),
  events: { emits: ["demo.installed"] },
});
