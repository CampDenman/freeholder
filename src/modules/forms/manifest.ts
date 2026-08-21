// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The forms module (MASTER.md §11, §4.6, §36).
//
// Two firsts, and both are contract tests rather than features:
//
//   - **A module that contributes a block type.** `blocks` is the seam §24
//     promises plugins: the form block joins the palette, the editor derives
//     its controls from the block's own Zod schema, and the editor changes not
//     at all. `requires: ["cms"]` is what guarantees the registry exists to
//     join — the topo-sort is doing real work.
//   - **A module whose public surface writes.** Everything the platform claims
//     about the spine is exercised on an anonymous path here: a visitor's
//     submission becomes a Contact through `contacts.resolve` and
//     `ctx.callAsSystem`, with no permission of their own to create one.
//
// Still no `routes` entry. The form reaches the public surface as a block on a
// page (§32), and the only endpoint involved is the Server Action the block's
// markup posts to.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "forms",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  briefing: { contributors: ["forms.briefingEnquiries"] },
  onboarding: () => import("./onboarding"),
  blocks: () => import("./blocks"),
  events: {
    emits: ["forms.created", "forms.updated", "forms.deleted", "forms.submitted"],
    // Its own event, handled by itself: the notification is a consequence of a
    // submission rather than part of it, and a visitor must never wait for
    // notification fanout to be told "thank you".
    listens: { "forms.submitted": "onFormSubmitted" },
  },
});
