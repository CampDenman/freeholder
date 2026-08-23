// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The quotes list, as something a view can be kept of (C7.06).
//
// Declared by the module rather than listed in core, so switching quotes off
// takes its saved views with it instead of leaving a dead entry in somebody's
// sidebar. The same seam a module uses to register a contact reference, a
// briefing section or a segment field.
import { registerViewEntity } from "@/core/views/service";

registerViewEntity({
  key: "quotes",
  label: "Quotes",
  path: "/admin/quotes",
  module: "quotes",
  filters: [{ key: "status", label: "Status" }],
  // Rows rather than a table, so nothing to pick between.
  columns: [],
  defaultColumns: [],
});
