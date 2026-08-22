// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The projects module (MASTER.md §11, §4.7, C6.15).
//
// `requires: ["core"]` and nothing else, which is the point. A project links
// to quotes, agreements, bookings, invoices and rentals — and imports none of
// them. The link table is polymorphic and its ids are untyped precisely so
// this module installs on an instance that has switched half of those off,
// and so C6.13 can attach a new kind without a dependency appearing here.
//
// The reverse lookup (`projects.forSubject`) is how an invoice screen says
// "part of the Henderson kitchen" without invoicing learning what a project
// is: it asks the registry rather than importing anything.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "projects",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["project.created", "project.completed"],
  },
});
