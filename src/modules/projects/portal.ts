// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own projects, in the portal (MASTER.md §43 C8.11).
//
// Where the work has got to. §4 treats a project as the thing a client is
// actually buying, so it belongs in the client's own view of the relationship.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listProjects } from "./service";

registerPortalSection({
  key: "projects",
  order: 70,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listProjects, { contactId, limit });
    return rows.map((project) => ({
      id: project.id,
      title: project.clientDisplayName ?? project.title,
      status: project.status,
      at: project.updatedAt ?? project.createdAt ?? null,
      href: null,
    }));
  },
});
