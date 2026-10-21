// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The optional front-site assistant (MASTER.md §31, C9.21).
//
// §31's first clause is why this is a module and not a feature of core: "An
// optional module (`growth/assistant`), **off by default**". Most instances
// will never switch it on, and the ones that do are choosing to spend money
// on every visitor question.
//
// It requires only core. The chat surface it answers on is C7.15's, which is
// core messaging; the actions it can take are resolved by service name at the
// moment they are asked for, so an instance without cms simply has one fewer
// thing the assistant may do rather than a module that will not boot.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "assistant",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: {
    // Both are worth an automation: "the assistant answered somebody" is a
    // moment a business might follow up on, and "the assistant refused" is one
    // an owner may want to hear about before a visitor tells them.
    emits: ["assistant.replied", "assistant.refused"],
    // Publish a change → index updates. No copy-paste maintenance (§31).
    listens: {
      "cms.pagePublished": "onContentChanged",
      "cms.pageUnpublished": "onContentChanged",
      "cms.pageDeleted": "onContentChanged",
      "location.created": "onContentChanged",
      "location.updated": "onContentChanged",
      "location.deleted": "onContentChanged",
      "catalog.productActivated": "onContentChanged",
      "catalog.productArchived": "onContentChanged",
      "catalog.productUpdated": "onContentChanged",
      "catalog.productVisibilityChanged": "onContentChanged",
      "settings.setupCompleted": "onContentChanged",
    },
  },
});
