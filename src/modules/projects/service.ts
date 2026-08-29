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
import { pages } from "@/modules/cms/schema";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { isUniqueViolation } from "@/core/db";
import { defineService, getService, ServiceError, type Actor } from "@/core/service";
// The checklist is the platform's one task list (C7.02), not a second one.
// C6.15 shipped `project_tasks` before that table existed; these services keep
// their names and their shape and write through core, so a project's list and
// "what am I meant to be doing today" can never disagree.
import { TASK_STATUSES, tasks as coreTasks } from "@/core/tasks/schema";
import {
  PROJECT_FILE_ROLES,
  PROJECT_LINK_KINDS,
  PROJECT_PUBLICATION_STATUSES,
  PROJECT_STATUSES,
  PROJECT_CONSENT_METHODS,
  TESTIMONIAL_STATUSES,
  projectFiles,
  projectLinks,
  projectOutcomes,
  projectTestimonials,
  projects,
} from "./schema";
// Claims this module's room in the customer portal (C8.11). Imported for
// its side effect: core owns the registry so it never imports a module,
// and something has to make the claim at load time.
import "./portal";

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
  blocks: z.unknown(),
  coverAssetId: uuid.nullable(),
  featured: z.boolean(),
  seo: z.unknown(),
  publicationStatus: z.enum(PROJECT_PUBLICATION_STATUSES),
  publishedAt: timestamp.nullable(),
  publicPageId: uuid.nullable(),
  clientConsentGivenAt: timestamp.nullable(),
  clientConsentMethod: z.enum(PROJECT_CONSENT_METHODS).nullable(),
  clientConsentNote: z.string().nullable(),
  version: z.number().int(),
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

/**
 * A core task seen from a project's side.
 *
 * The project screens ask for a date rather than a moment, so the day is what
 * comes back — the checklist means "by Friday", not "by 09:00 on Friday".
 */
function asProjectTask(task: {
  id: string;
  subjectId: string | null;
  title: string;
  status: (typeof TASK_STATUSES)[number];
  assigneeUserId: string | null;
  dueAt: Date | null;
  position: number;
  completedAt: Date | null;
}) {
  return {
    id: task.id,
    projectId: task.subjectId!,
    title: task.title,
    status: task.status,
    assigneeUserId: task.assigneeUserId,
    dueOn: task.dueAt ? task.dueAt.toISOString().slice(0, 10) : null,
    position: task.position,
    doneAt: task.completedAt,
  };
}

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

const testimonialRow = row({
  id: uuid,
  projectId: uuid,
  contactId: uuid,
  displayName: z.string(),
  role: z.string().nullable(),
  body: z.string(),
  rating: z.number().int().nullable(),
  assetId: uuid.nullable(),
  consentGivenAt: timestamp,
  consentMethod: z.enum(PROJECT_CONSENT_METHODS),
  consentNote: z.string().nullable(),
  status: z.enum(TESTIMONIAL_STATUSES),
  displayLocations: z.array(z.string()),
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
        version: existing.version + 1,
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
    // Through core, in this transaction: the position, the contact the task is
    // really about, and the event all come from one place rather than being
    // re-derived here and drifting.
    const created = await ctx.call(getService("tasks.create"), {
      subjectType: "project",
      subjectId: input.projectId,
      title: input.title,
      assigneeUserId: input.assigneeUserId ?? null,
      // A checklist date is a day. Midday UTC rather than midnight, so a
      // business either side of the line still sees the day it typed.
      dueAt: input.dueOn ? `${input.dueOn}T12:00:00.000Z` : null,
    });
    ctx.setSubject("project", input.projectId);
    return asProjectTask(created as Parameters<typeof asProjectTask>[0]);
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
    const result = (await ctx.call(getService("tasks.setStatus"), {
      id: input.id,
      status: input.status,
    })) as { task: Parameters<typeof asProjectTask>[0] };
    const task = asProjectTask(result.task);
    ctx.setSubject("project", task.projectId);
    return task;
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
    const removed = (await ctx.call(getService("tasks.remove"), { id: input.id })) as {
      id: string;
    };
    return removed;
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
    let attached: typeof projectFiles.$inferSelect | undefined;
    try {
      [attached] = await ctx.tx
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
    } catch (error) {
      if (isUniqueViolation(error, "project_files_pair_role_idx")) {
        throw new ServiceError(
          "conflict",
          `That pair already has a ${input.role} image. Remove it before choosing another.`,
        );
      }
      throw error;
    }
    ctx.setSubject("project", input.projectId);
    return attached!;
  },
});

export const listProjects = defineService({
  name: "projects.list",
  summary: "Work in hand, and work finished.",
  kind: "query",
  permission: "scoped",
  // C8.11: the customer this asks about may ask it themselves. The
  // contract layer verifies the field is present and is their own contact
  // before the handler runs, so this widens what a customer can *see*
  // about themselves and nothing else.
  selfService: { contactField: "contactId" },
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
          projectId: coreTasks.subjectId,
          open: sql<number>`count(*)::int`,
        })
        .from(coreTasks)
        .where(
          and(
            eq(coreTasks.subjectType, "project"),
            inArray(coreTasks.subjectId, rows.map((r) => r.project.id)),
            // Cancelled counts as off the list: it is not outstanding work.
            sql`${coreTasks.status} not in ('done', 'cancelled')`,
          ),
        )
        .groupBy(coreTasks.subjectId);
      for (const entry of grouped) counts.set(entry.projectId!, entry.open);
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
      testimonials: listed(testimonialRow),
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

    const [links, tasks, outcomes, files, testimonials] = await Promise.all([
      ctx.tx
        .select()
        .from(projectLinks)
        .where(eq(projectLinks.projectId, input.id))
        .orderBy(asc(projectLinks.kind), asc(projectLinks.createdAt)),
      ctx.tx
        .select()
        .from(coreTasks)
        .where(and(eq(coreTasks.subjectType, "project"), eq(coreTasks.subjectId, input.id)))
        .orderBy(asc(coreTasks.position)),
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
      ctx.tx
        .select()
        .from(projectTestimonials)
        .where(eq(projectTestimonials.projectId, input.id))
        .orderBy(asc(projectTestimonials.createdAt)),
    ]);
    return {
      ...found.project,
      contactName: found.contactName,
      tasks: tasks.map(asProjectTask),
      links,
      outcomes,
      files,
      testimonials,
    };
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

registerContactReference({
  table: "project_testimonials",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(projectTestimonials)
      .set({ contactId: survivingId })
      .where(eq(projectTestimonials.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: projectTestimonials.id, contactId: projectTestimonials.contactId })
      .from(projectTestimonials)
      .where(inArray(projectTestimonials.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((testimonial) => testimonial.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(projectTestimonials)
        .set({ contactId: duplicateId })
        .where(inArray(projectTestimonials.id, moved.map((testimonial) => testimonial.id)));
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
    const affectedProjects = await tx
      .select({ id: projects.id, publicPageId: projects.publicPageId })
      .from(projects)
      .where(eq(projects.contactId, contactId));
    const pageIds = affectedProjects
      .map((project) => project.publicPageId)
      .filter((pageId): pageId is string => pageId !== null);
    if (pageIds.length) {
      // A snapshot may contain the public client name. Privacy erasure takes
      // the whole case study offline and scrubs both its live and working CMS
      // copies in the same transaction.
      const projectIds = new Set(affectedProjects.map((project) => project.id));
      const snapshots = await tx.select().from(pages).where(inArray(pages.id, pageIds));
      for (const page of snapshots) {
        const scrub = (input: unknown): BlockNode[] => {
          if (!Array.isArray(input)) return [];
          return (input as BlockNode[]).map((block) =>
            block.type === "projectCaseStudy" &&
            projectIds.has(typeof block.props.projectId === "string" ? block.props.projectId : "")
              ? { ...block, props: { ...block.props, clientDisplayName: null } }
              : block,
          );
        };
        await tx
          .update(pages)
          .set({
            status: "draft",
            publishedAt: null,
            blocks: scrub(page.blocks),
            workingBlocks: scrub(page.workingBlocks ?? page.blocks),
            updatedAt: sql`now()`,
          })
          .where(eq(pages.id, page.id));
      }
    }
    const rows = await tx
      .update(projects)
      .set({
        contactId: null,
        // What to call them publicly goes too: "the Hendersons" is the person
        // as surely as their contact record is.
        clientDisplayName: null,
        notes: null,
        clientConsentGivenAt: null,
        clientConsentMethod: null,
        clientConsentNote: null,
        publicationStatus: "draft",
        publishedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.contactId, contactId))
      .returning({ id: projects.id });
    return { affected: rows.length };
  },
});

function withoutTestimonials(blocks: unknown, ids: Set<string>): BlockNode[] {
  if (!Array.isArray(blocks)) return [];
  return (blocks as BlockNode[]).map((block) => {
    if (block.type !== "projectCaseStudy") return block;
    const testimonials = Array.isArray(block.props.testimonials)
      ? block.props.testimonials.filter(
          (entry) =>
            typeof entry !== "object" ||
            entry === null ||
            !ids.has((entry as { id?: string }).id ?? ""),
        )
      : [];
    return { ...block, props: { ...block.props, testimonials } };
  });
}

registerContactPrivacySource({
  scope: "contact.projectTestimonials",
  tables: ["project_testimonials", "pages"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(projectTestimonials)
      .where(eq(projectTestimonials.contactId, contactId))
      .orderBy(asc(projectTestimonials.createdAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .select({ id: projectTestimonials.id, projectId: projectTestimonials.projectId })
      .from(projectTestimonials)
      .where(eq(projectTestimonials.contactId, contactId));
    if (!rows.length) return { affected: 0 };
    const ids = new Set(rows.map((testimonial) => testimonial.id));
    const projectIds = [...new Set(rows.map((testimonial) => testimonial.projectId))];
    const linked = await tx
      .select({ publicPageId: projects.publicPageId })
      .from(projects)
      .where(inArray(projects.id, projectIds));
    const pageIds = linked
      .map((project) => project.publicPageId)
      .filter((pageId): pageId is string => pageId !== null);
    if (pageIds.length) {
      const snapshots = await tx.select().from(pages).where(inArray(pages.id, pageIds));
      for (const page of snapshots) {
        await tx
          .update(pages)
          .set({
            blocks: withoutTestimonials(page.blocks, ids),
            workingBlocks: withoutTestimonials(page.workingBlocks ?? page.blocks, ids),
            updatedAt: sql`now()`,
          })
          .where(eq(pages.id, page.id));
      }
    }
    await tx
      .delete(projectTestimonials)
      .where(eq(projectTestimonials.contactId, contactId));
    return { affected: rows.length };
  },
});

import timeServices from "./time-service";
import publishingServices from "./publishing-service";
import portfolioServices from "./portfolio-service";

export default [
  ...timeServices,
  ...publishingServices,
  ...portfolioServices,
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
