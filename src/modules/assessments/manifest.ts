// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-authored guided assessments (MASTER.md §4.18, C8.14).
//
// Requires cms because the surface a respondent meets is a block on a page
// (§32), and forms is *not* a dependency: an assessment produces a scored
// outcome, a form collects an answer, and making one need the other would mean
// a clinic that wants a triage questionnaire must also switch on lead capture.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "assessments",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  onboarding: () => import("./onboarding"),
  events: {
    emits: [
      "assessment.published",
      "assessment.closed",
      "assessment.responded",
      "assessment.escalated",
    ],
  },
});
