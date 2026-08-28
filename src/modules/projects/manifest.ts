// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The projects module (MASTER.md §11, §4.7, C6.15).
//
// The operational services still link to optional modules without importing
// to quotes, agreements, bookings, invoices and rentals — and imports none of
// them. The link table is polymorphic and its ids are untyped precisely so
// this module works with half of those switched off. C8.01 adds only CMS as a
// dependency, because a published case study is a CMS page snapshot.
//
// The reverse lookup (`projects.forSubject`) is how an invoice screen says
// "part of the Henderson kitchen" without invoicing learning what a project
// is: it asks the registry rather than importing anything.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "projects",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  events: {
    emits: ["project.created", "project.completed", "project.published", "project.unpublished"],
  },
});
