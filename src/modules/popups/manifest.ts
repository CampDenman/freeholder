// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Popups, announcement surfaces and exit intent (MASTER.md §36, C9.30).
//
// §36 puts this in the "absorb into core" column — it is table stakes that the
// tool-mash proves — and then names the four properties that make it worth
// absorbing rather than installing: "block-editor-built, frequency-capped,
// targeting rules; newsletter capture wired to §30 consent records."
//
// A module rather than core, because plenty of instances will never want one,
// and the honest way to make something optional is to make it removable.
//
// `requires: ["cms"]` is load-bearing twice over. A popup's body is a block
// tree validated against the CMS registry, and its accessibility is analysed
// by the CMS's own hint pass — so the popup gets the platform's answers to
// "what may this contain" and "is this readable" rather than growing its own.
//
// No `routes` and no `blocks`. A popup does not join the palette: it is a
// surface that renders *around* the page rather than inside it, mounted once
// by the public shell. That is also why there is no ambition here to let a
// popup contain a popup.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "popups",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["popups.saved", "popups.statusChanged", "popups.captured"],
  },
});
