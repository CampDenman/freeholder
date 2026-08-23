// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core's own saveable lists (C7.06).
//
// Declared here rather than inside each page, so the set is complete the moment
// anything imports it — a "keep this view" control that renders on a list the
// registry has never heard of would refuse the save at the last moment, which
// is the worst place to find out.
//
// A module's lists are declared by the module, so switching one off takes its
// views with it rather than leaving a dead entry in somebody's sidebar.
import { registerViewEntity } from "./registry";

registerViewEntity({
  key: "contacts",
  label: "Contacts",
  path: "/admin/contacts",
  module: "contacts",
  filters: [
    { key: "search", label: "Search" },
    { key: "stage", label: "Lifecycle stage" },
    { key: "tag", label: "Tag" },
  ],
  columns: [
    // The name is fixed because it carries the link. A row nobody can open is
    // not a shorter row, it is a broken one.
    { key: "name", label: "Name", fixed: true },
    { key: "email", label: "Email" },
    { key: "stage", label: "Stage" },
    { key: "added", label: "Added" },
    { key: "phone", label: "Phone" },
    { key: "country", label: "Country" },
    { key: "tags", label: "Tags" },
  ],
  defaultColumns: ["name", "email", "stage", "added"],
});

registerViewEntity({
  key: "tasks",
  label: "Tasks",
  path: "/admin/tasks",
  module: "crm",
  filters: [{ key: "view", label: "Whose" }],
  // A list of rows rather than a table: a column picker here would be a control
  // with nothing to control.
  columns: [],
  defaultColumns: [],
});
