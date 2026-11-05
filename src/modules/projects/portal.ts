// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own projects, in the portal (MASTER.md §43 C8.11, C3.37).
//
// Where the work has got to. §4 treats a project as the thing a client is
// actually buying, so it belongs in the client's own view of the relationship.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
//
// C3.37 adds the customer's words for where it is — New, In progress,
// Delivered rather than the owner's enquiry/active/complete — and, on the
// project itself, what was delivered: the owner's note and every file shared
// to this customer's sign-in, each downloaded through the session-bound
// `/portal/files/[id]` route. Documents is an optional module, reached by
// name, so projects still installs without it.
import { listServices, getService } from "@/core/service";
import { registerPortalSection } from "@/core/portal/sections";
import { listProjects } from "./service";

type SharedDocument = { id: string; title: string };
type StandingShare = {
  contactId: string | null;
  access: string;
  downloadPolicy: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

/** The customer's word for a project's state, as a catalog key. */
export function projectStatusKey(status: string): string {
  return `portal.project.status.${status}`;
}

registerPortalSection({
  key: "projects",
  order: 70,
  detail: async (ctx, contactId, id) => {
    const project = (await ctx.call(listProjects, { contactId, limit: 200 })).find((row) => row.id === id);
    if (!project) throw new Error("Project ownership changed.");
    const fields = [
      ...(project.summary ? [{ labelKey: "portal.record.description", value: project.summary }] : []),
      ...(project.startedOn ? [{ labelKey: "portal.record.starts", value: project.startedOn }] : []),
      ...(project.completedAt ? [{ labelKey: "portal.record.completed", value: project.completedAt.toISOString() }] : []),
      ...(project.deliveryNote ? [{ labelKey: "portal.project.deliveryNote", value: project.deliveryNote }] : []),
    ];
    const links: { labelKey: string; href: string; params: Record<string, string> }[] = [];
    if (listServices().has("documents.list") && listServices().has("documents.shares")) {
      // The customer's own query: documents.list is self-service, so it
      // answers only for this contact and only what is shared.
      const delivered = (await ctx.call(getService("documents.list"), {
        contactId,
        subjectType: "project",
        subjectId: project.id,
        status: "shared",
        limit: 50,
      })) as SharedDocument[];
      const now = Date.now();
      for (const document of delivered) {
        // Which shares stand is the owner's record, read by elevation for a
        // document already proven to be this customer's. A link is offered
        // only where the download route would honour it.
        const standing = (await ctx.callAsSystem(getService("documents.shares"), {
          documentId: document.id,
        })) as StandingShare[];
        const live = standing.some(
          (entry) =>
            entry.contactId === contactId &&
            entry.access === "login" &&
            entry.downloadPolicy !== "none" &&
            !entry.revokedAt &&
            (!entry.expiresAt || entry.expiresAt.getTime() > now),
        );
        if (live) {
          links.push({
            labelKey: "portal.project.download",
            href: `/portal/files/${document.id}`,
            params: { title: document.title },
          });
        }
      }
    }
    return { fields, links };
  },
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listProjects, { contactId, limit });
    return rows.map((project) => ({
      id: project.id,
      title: project.clientDisplayName ?? project.title,
      status: project.status,
      statusKey: projectStatusKey(project.status),
      at: project.updatedAt ?? project.createdAt ?? null,
      href: `/portal/records/projects/${project.id}`,
    }));
  },
});
