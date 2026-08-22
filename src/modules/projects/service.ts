// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Running a piece of work (MASTER.md §4.7, C6.15).
//
// A project is the answer to "what is going on with the Hendersons?" — one
// place where the quote they accepted, the agreement they signed, the three
// appointments in the diary and the invoice that is still unpaid are the same
// job rather than four searches.
//
// **It links rather than copies.** Every attachment is a pointer, so the
// invoice on a project *is* the invoice in the ledger and the booking *is* the
// one in the diary. A project that held its own copy of a total would be a
// second answer to what the customer owes, and the first thing anybody would
// do with it is quote the wrong one.
//
// **It never becomes a second notion of a customer.** The client is a
// `contact_id`, resolved through the spine like everything else, and
// `clientDisplayName` is what to *call* them publicly rather than who they are.
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError, type Actor } from "@/core/service";
import {
  PROJECT_FILE_ROLES,
  PROJECT_LINK_KINDS,
  PROJECT_STATUSES,
  TASK_STATUSES,
  projectFiles,
  projectLinks,
  projectOutcomes,
  projectTasks,
  projects,
} from "./schema";

const id = z.string().uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case words separated by hyphens.")
  .max(120);

/**
 * A person, or the platform acting for one.
 *
 * `permission: "scoped"` already refuses anonymous and unscoped callers, so
 * what this adds is a plain sentence for somebody whose session has expired.
 * **The system actor passes**, deliberately: an accepted quote turning itself
 * into a job (C6.13) is elevation from a caller that has already established
 * authority, and refusing it there is exactly the bug that made C6.09's
 * confirm gate fail with "Sign in to manage agreements."
 */
function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage projects.");
  }
}

/** A readable slug from a title, so nobody has to invent one. */
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "project"
  );
}

const projectRow = row({
  id: uuid,
  contactId: uuid.nullable(),
  clientDisplayName: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  ownerUserId: uuid.nullable(),
  locationId: uuid.nullable(),
  serviceProductIds: z.array(uuid),
  startedOn: z.string().nullable(),
  occurredOn: z.string().nullable(),
  completedAt: timestamp.nullable(),
  notes: z.string().nullable(),
});

const linkRow = row({
  id: uuid,
  projectId: uuid,
  kind: z.enum(PROJECT_LINK_KINDS),
  targetId: uuid,
  label: z.string().nullable(),
});

const taskRow = row({
  id: uuid,
  projectId: uuid,
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  assigneeUserId: uuid.nullable(),
  dueOn: z.string().nullable(),
  position: z.number().int(),
  doneAt: timestamp.nullable(),
});

const outcomeRow = row({
  id: uuid,
  projectId: uuid,
  label: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
  method: z.string().nullable(),
  position: z.number().int(),
});

const fileRow = row({
  id: uuid,
  projectId: uuid,
  assetId: uuid,
  role: z.enum(PROJECT_FILE_ROLES),
  pairKey: z.string().nullable(),
  caption: z.string().nullable(),
  position: z.number().int(),
});

export const createProject = defineService({
  name: "projects.create",
  summary: "Start a piece of work.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    title: z.string().trim().min(1).max(200),
    slug: slug.optional(),
    contactId: id.nullish(),
    clientDisplayName: z.string().trim().max(200).nullish(),
    summary: z.string().trim().max(5_000).nullish(),
    ownerUserId: id.nullish(),
    locationId: id.nullish(),
    serviceProductIds: z.array(id).max(50).default([]),
    startedOn: z.string().date().nullish(),
    notes: z.string().trim().max(20_000).nullish(),
  }),
  output: projectRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.contactId) {
      const [contact] = await ctx.tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1);
      if (!contact) throw new ServiceError("not_found", "No such contact.");
    }

    try {
      const [created] = await ctx.tx
        .insert(projects)
        .values({
          title: input.title,
          slug: input.slug ?? slugify(input.title),
          contactId: input.contactId ?? null,
          clientDisplayName: input.clientDisplayName ?? null,
          summary: input.summary ?? null,
          ownerUserId: input.ownerUserId ?? null,
          locationId: input.locationId ?? null,
          serviceProductIds: input.serviceProductIds,
          startedOn: input.startedOn ?? null,
          notes: input.notes ?? null,
        })
        .returning();

      if (created!.contactId) {
        await ctx.emitTimeline({
          contactId: created!.contactId,
          eventType: "project.created",
          subjectType: "project",
          subjectId: created!.id,
          payload: { title: created!.title },
        });
      }
      ctx.setSubject("project", created!.id);
      ctx.queueEvent("project.created", {
        id: created!.id,
        contactId: created!.contactId,
      });
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "projects_slug_idx")) {
        // The slug is the public address C8.01 will publish at, so a
        // collision is a naming decision rather than an internal error.
        throw new ServiceError(
          "conflict",
          "Another project already uses that web address. Choose a different one.",
        );
      }
      throw error;
    }
  },
});

export const updateProject = defineService({
  name: "projects.update",
  summary: "Change what a project says about itself.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(5_000).nullish(),
    clientDisplayName: z.string().trim().max(200).nullish(),
    status: z.enum(PROJECT_STATUSES).optional(),
    ownerUserId: id.nullish(),
    locationId: id.nullish(),
    serviceProductIds: z.array(id).max(50).optional(),
    startedOn: z.string().date().nullish(),
    occurredOn: z.string().date().nullish(),
    notes: z.string().trim().max(20_000).nullish(),
  }),
  output: projectRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx
      .select()
      .from(projects)
      .where(eq(projects.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That project is not here.");

    const completing = input.status === "complete" && existing.status !== "complete";
    const [updated] = await ctx.tx
      .update(projects)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
        ...(input.clientDisplayName !== undefined
          ? { clientDisplayName: input.clientDisplayName ?? null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.ownerUserId !== undefined
          ? { ownerUserId: input.ownerUserId ?? null }
          : {}),
        ...(input.locationId !== undefined ? { locationId: input.locationId ?? null } : {}),
        ...(input.serviceProductIds !== undefined
          ? { serviceProductIds: input.serviceProductIds }
          : {}),
        ...(input.startedOn !== undefined ? { startedOn: input.startedOn ?? null } : {}),
        ...(input.occurredOn !== undefined ? { occurredOn: input.occurredOn ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        // Stamped by the platform rather than typed, and only on the way in.
        // A completion date somebody can edit is a completion date nothing can
        // be reported from.
        ...(completing ? { completedAt: new Date() } : {}),
        // The slug is deliberately absent. It is the address C8.01 publishes
        // at, and §5's rule is that slugs never silently break.
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, input.id))
      .returning();

    if (completing && updated!.contactId) {
      await ctx.emitTimeline({
        contactId: updated!.contactId,
        eventType: "project.completed",
        subjectType: "project",
        subjectId: updated!.id,
        payload: { title: updated!.title },
      });
    }
    ctx.setSubject("project", updated!.id);
    if (completing) {
      ctx.queueEvent("project.completed", {
        id: updated!.id,
        contactId: updated!.contactId,
      });
    }
    return updated!;
  },
});

export const linkToProject = defineService({
  name: "projects.link",
  summary: "Attach a quote, agreement, booking or invoice to a project.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    projectId: id,
    kind: z.enum(PROJECT_LINK_KINDS),
    targetId: id,
    label: z.string().trim().max(200).nullish(),
  }),
  output: linkRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [project] = await ctx.tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new ServiceError("not_found", "That project is not here.");

    // Attaching the same thing twice is a double click, not a second
    // attachment — so the label is refreshed and the row stays one row.
    const [linked] = await ctx.tx
      .insert(projectLinks)
      .values({
        projectId: input.projectId,
        kind: input.kind,
        targetId: input.targetId,
        label: input.label ?? null,
      })
      .onConflictDoUpdate({
        target: [projectLinks.projectId, projectLinks.kind, projectLinks.targetId],
        set: { label: input.label ?? null, updatedAt: sql`now()` },
      })
      .returning();
    ctx.setSubject("project", input.projectId);
    return linked!;
  },
});

export const unlinkFromProject = defineService({
  name: "projects.unlink",
  summary: "Take something off a project without deleting it.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Only the link goes. The invoice, the booking and the agreement are the
    // business's records and belong to themselves, not to the project.
    const [removed] = await ctx.tx
      .delete(projectLinks)
      .where(eq(projectLinks.id, input.id))
      .returning({ id: projectLinks.id, projectId: projectLinks.projectId });
    if (!removed) throw new ServiceError("not_found", "That attachment is not here.");
    ctx.setSubject("project", removed.projectId);
    return { id: removed.id };
  },
});

export const addTask = defineService({
  name: "projects.addTask",
  summary: "Add something that has to happen.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    projectId: id,
    title: z.string().trim().min(1).max(300),
    assigneeUserId: id.nullish(),
    dueOn: z.string().date().nullish(),
  }),
  output: taskRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [last] = await ctx.tx
      .select({ position: projectTasks.position })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, input.projectId))
      .orderBy(desc(projectTasks.position))
      .limit(1);
    const [created] = await ctx.tx
      .insert(projectTasks)
      .values({
        projectId: input.projectId,
        title: input.title,
        assigneeUserId: input.assigneeUserId ?? null,
        dueOn: input.dueOn ?? null,
        position: (last?.position ?? -1) + 1,
      })
      .returning();
    ctx.setSubject("project", input.projectId);
    return created!;
  },
});

export const setTaskStatus = defineService({
  name: "projects.setTaskStatus",
  summary: "Move a task along.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, status: z.enum(TASK_STATUSES) }),
  output: taskRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(projectTasks)
      .set({
        status: input.status,
        // Set on the way in and cleared on the way out, so "done on" is always
        // the moment it was actually marked rather than the first time it ever
        // was.
        doneAt: input.status === "done" ? new Date() : null,
        updatedAt: sql`now()`,
      })
      .where(eq(projectTasks.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That task is not here.");
    ctx.setSubject("project", updated.projectId);
    return updated;
  },
});

export const removeTask = defineService({
  name: "projects.removeTask",
  summary: "Take a task off the list.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(projectTasks)
      .where(eq(projectTasks.id, input.id))
      .returning({ id: projectTasks.id, projectId: projectTasks.projectId });
    if (!removed) throw new ServiceError("not_found", "That task is not here.");
    ctx.setSubject("project", removed.projectId);
    return { id: removed.id };
  },
});

export const setOutcome = defineService({
  name: "projects.setOutcome",
  summary: "Record what the work achieved, and how that was measured.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    projectId: id,
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(120),
    unit: z.string().trim().max(30).nullish(),
    /**
     * How it was measured. Optional in the schema and asked for in the UI,
     * because §4.7's point is that a claim nobody can substantiate is a claim
     * the business is making up — and the field being *there* is what makes
     * an owner notice they cannot fill it.
     */
    method: z.string().trim().max(500).nullish(),
  }),
  output: outcomeRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [last] = await ctx.tx
      .select({ position: projectOutcomes.position })
      .from(projectOutcomes)
      .where(eq(projectOutcomes.projectId, input.projectId))
      .orderBy(desc(projectOutcomes.position))
      .limit(1);
    const [created] = await ctx.tx
      .insert(projectOutcomes)
      .values({
        projectId: input.projectId,
        label: input.label,
        value: input.value,
        unit: input.unit ?? null,
        method: input.method ?? null,
        position: (last?.position ?? -1) + 1,
      })
      .returning();
    ctx.setSubject("project", input.projectId);
    return created!;
  },
});

export const attachFile = defineService({
  name: "projects.attachFile",
  summary: "Put a photograph or a document on a project.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    projectId: id,
    assetId: id,
    role: z.enum(PROJECT_FILE_ROLES).default("gallery"),
    /** Ties a `before` to its `after` (§4.7: a pairing, not two uploads). */
    pairKey: z.string().trim().max(80).nullish(),
    caption: z.string().trim().max(500).nullish(),
  }),
  output: fileRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const pairing = input.role === "before" || input.role === "after";
    if (pairing && !input.pairKey) {
      throw new ServiceError(
        "validation",
        "A before or after needs a pair name, so the two can be shown together.",
      );
    }
    if (!pairing && input.pairKey) {
      throw new ServiceError("validation", "Only a before or after is paired.");
    }

    const [last] = await ctx.tx
      .select({ position: projectFiles.position })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, input.projectId))
      .orderBy(desc(projectFiles.position))
      .limit(1);
    const [attached] = await ctx.tx
      .insert(projectFiles)
      .values({
        projectId: input.projectId,
        assetId: input.assetId,
        role: input.role,
        pairKey: input.pairKey ?? null,
        caption: input.caption ?? null,
        position: (last?.position ?? -1) + 1,
      })
      .onConflictDoUpdate({
        target: [projectFiles.projectId, projectFiles.assetId, projectFiles.role],
        set: {
          pairKey: input.pairKey ?? null,
          caption: input.caption ?? null,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    ctx.setSubject("project", input.projectId);
    return attached!;
  },
});

export const listProjects = defineService({
  name: "projects.list",
  summary: "Work in hand, and work finished.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(PROJECT_STATUSES).optional(),
    contactId: id.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    projectRow.extend({
      contactName: z.string().nullable(),
      openTasks: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx
      .select({ project: projects, contactName: contacts.name })
      .from(projects)
      .leftJoin(contacts, eq(contacts.id, projects.contactId))
      .where(
        and(
          input.status ? eq(projects.status, input.status) : undefined,
          input.contactId ? eq(projects.contactId, input.contactId) : undefined,
        ),
      )
      .orderBy(desc(projects.createdAt))
      .limit(input.limit);

    // Counted with a grouped query and merged, rather than a correlated
    // subquery inside the select — which silently returns zero in this ORM.
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const grouped = await ctx.tx
        .select({
          projectId: projectTasks.projectId,
          open: sql<number>`count(*)::int`,
        })
        .from(projectTasks)
        .where(
          and(
            inArray(projectTasks.projectId, rows.map((r) => r.project.id)),
            sql`${projectTasks.status} <> 'done'`,
          ),
        )
        .groupBy(projectTasks.projectId);
      for (const entry of grouped) counts.set(entry.projectId, entry.open);
    }

    return rows.map(({ project, contactName }) => ({
      ...project,
      contactName,
      openTasks: counts.get(project.id) ?? 0,
    }));
  },
});

export const getProject = defineService({
  name: "projects.get",
  summary: "One job: everything attached to it, in one answer.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: projectRow
    .extend({
      contactName: z.string().nullable(),
      links: listed(linkRow),
      tasks: listed(taskRow),
      outcomes: listed(outcomeRow),
      files: listed(fileRow),
    })
    .nullable(),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [found] = await ctx.tx
      .select({ project: projects, contactName: contacts.name })
      .from(projects)
      .leftJoin(contacts, eq(contacts.id, projects.contactId))
      .where(eq(projects.id, input.id))
      .limit(1);
    if (!found) return null;

    const [links, tasks, outcomes, files] = await Promise.all([
      ctx.tx
        .select()
        .from(projectLinks)
        .where(eq(projectLinks.projectId, input.id))
        .orderBy(asc(projectLinks.kind), asc(projectLinks.createdAt)),
      ctx.tx
        .select()
        .from(projectTasks)
        .where(eq(projectTasks.projectId, input.id))
        .orderBy(asc(projectTasks.position)),
      ctx.tx
        .select()
        .from(projectOutcomes)
        .where(eq(projectOutcomes.projectId, input.id))
        .orderBy(asc(projectOutcomes.position)),
      ctx.tx
        .select()
        .from(projectFiles)
        .where(eq(projectFiles.projectId, input.id))
        .orderBy(asc(projectFiles.position)),
    ]);
    return { ...found.project, contactName: found.contactName, links, tasks, outcomes, files };
  },
});

/**
 * Everything attached to one subject, whichever project it belongs to.
 *
 * The reverse lookup, so an invoice screen can say "part of the Henderson
 * kitchen" without every module learning what a project is. Reached by
 * elevation from those screens rather than made public: which jobs a business
 * has is not a customer's business.
 */
export const projectsForSubject = defineService({
  name: "projects.forSubject",
  summary: "Which project something belongs to.",
  kind: "query",
  permission: "scoped",
  input: z.object({ kind: z.enum(PROJECT_LINK_KINDS), targetId: id }),
  output: listed(row({ id: uuid, title: z.string(), status: z.enum(PROJECT_STATUSES) })),
  handler: (input, ctx) =>
    ctx.tx
      .select({ id: projects.id, title: projects.title, status: projects.status })
      .from(projectLinks)
      .innerJoin(projects, eq(projects.id, projectLinks.projectId))
      .where(and(eq(projectLinks.kind, input.kind), eq(projectLinks.targetId, input.targetId))),
});

/**
 * What a merge means for a project (CLAUDE.md's non-negotiable).
 *
 * Unconditional. A job belongs to whoever it was for, and one pointing at a
 * record that no longer exists is work the business cannot find.
 */
registerContactReference({
  table: "projects",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(projects)
      .set({ contactId: survivingId })
      .where(eq(projects.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: projects.id, contactId: projects.contactId })
      .from(projects)
      .where(inArray(projects.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((project) => project.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(projects)
        .set({ contactId: duplicateId })
        .where(inArray(projects.id, moved.map((project) => project.id)));
    }
  },
});

/**
 * What a project means for the person's own data (§30).
 *
 * The work survives and the person goes. A project is the business's own
 * record of what it did and when — its portfolio, its accounts, its history —
 * and deleting it would take that with the customer's data. What goes is the
 * link to them and what the business wrote about them.
 */
registerContactPrivacySource({
  scope: "contact.projects",
  tables: ["projects"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(projects)
      .where(eq(projects.contactId, contactId))
      .orderBy(asc(projects.createdAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(projects)
      .set({
        contactId: null,
        // What to call them publicly goes too: "the Hendersons" is the person
        // as surely as their contact record is.
        clientDisplayName: null,
        notes: null,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.contactId, contactId))
      .returning({ id: projects.id });
    return { affected: rows.length };
  },
});

export default [
  createProject,
  updateProject,
  linkToProject,
  unlinkFromProject,
  addTask,
  setTaskStatus,
  removeTask,
  setOutcome,
  attachFile,
  listProjects,
  getProject,
  projectsForSubject,
];
