// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Saved views (MASTER.md §4.14, C7.06).
//
// The whole of C7.06's "durable URL/state semantics" is one decision, and it
// was already made at the top of the contacts list: filtering is a GET form
// reading `searchParams`. So a saved view is **a named URL**, not a second
// filtering mechanism.
//
// That is worth stating plainly because the alternative is so common: a client
// held filter state, a saved view that serialises it, and a URL that says
// nothing — which breaks the back button, breaks bookmarks, and makes "send me
// the list you're looking at" impossible. Here the back button, a bookmark, a
// pasted link and a saved view are the same thing, and none of them needed
// building.
//
// Three rules the service holds.
//
// **A view belongs to its owner.** `shared` makes it visible; it never makes it
// editable. A saved filter a colleague can quietly redefine silently answers a
// different question the next time it opens.
//
// **A default is per person.** Two people want different first screens on the
// same list, and a business-wide default takes one of them away.
//
// **An unknown filter is ignored, not refused.** A view saved before a filter
// was renamed still opens; it simply filters by less. Refusing to load it would
// punish somebody for a change they did not make.
import { z } from "zod";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { listed, row, uuid } from "@/core/contract";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";
// Imported for its side effect: core's own lists are registered the moment
// anything touches this service.
import "./entities";
import { mayUseEntity, viewEntities, viewEntity } from "./registry";
import { savedViews } from "./schema";

export {
  registerViewEntity,
  viewEntities,
  viewEntity,
  meaningfulParams,
  toQueryString,
  mayUseEntity,
} from "./registry";
export type { ViewEntity, ViewColumn, ViewFilter } from "./registry";

const id = z.string().uuid();

function requireUser(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to keep a view.");
  }
  return actor.userId;
}

function knownEntity(key: string) {
  const entity = viewEntity(key);
  if (!entity) {
    // A list nothing declares is a list nothing can render, and storing a view
    // of one leaves a dead entry in somebody's sidebar forever.
    throw new ServiceError("validation", "That is not a list you can keep a view of.");
  }
  return entity;
}

const viewRow = row({
  id: uuid,
  entity: z.string(),
  name: z.string(),
  filters: z.record(z.string(), z.string()),
  columns: z.array(z.string()),
  sortKey: z.string().nullable(),
  sortDir: z.enum(["asc", "desc"]).nullable(),
  ownerUserId: uuid.nullable(),
  shared: z.boolean(),
  isDefault: z.boolean(),
});

export const saveView = defineService({
  name: "views.save",
  summary: "Keep the list somebody is looking at, by name.",
  kind: "mutation",
  // Anybody signed in, because the real gate is per list: `mayUseEntity` below
  // refuses a view of a list this person cannot open. A separate "views" module
  // grant would mean an owner had to hand out a permission for a feature that
  // is really just a bookmark.
  permission: "authenticated",
  writeClass: "write",
  input: z.object({
    id: id.optional(),
    entity: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(120),
    filters: z.record(z.string().max(60), z.string().max(500)).default({}),
    columns: z.array(z.string().max(60)).max(40).default([]),
    sortKey: z.string().trim().max(60).nullish(),
    sortDir: z.enum(["asc", "desc"]).nullish(),
    shared: z.boolean().default(false),
    isDefault: z.boolean().default(false),
  }),
  output: viewRow,
  handler: async (input, ctx) => {
    const userId = requireUser(ctx.actor);
    const entity = knownEntity(input.entity);
    if (!mayUseEntity(ctx.actor, entity)) {
      throw new ServiceError("permission", "That list is not yours to look at.");
    }
    // Only columns this list actually has. A stale key would render a blank
    // column with a header nobody can explain.
    const known = new Set(entity.columns.map((column) => column.key));
    const columns = input.columns.filter((column) => known.has(column));

    if (input.isDefault) await clearDefault(ctx, input.entity, userId);

    if (input.id) {
      const [existing] = await ctx.tx
        .select({ ownerUserId: savedViews.ownerUserId })
        .from(savedViews)
        .where(eq(savedViews.id, input.id))
        .limit(1);
      if (!existing) throw new ServiceError("not_found", "That view is not here.");
      if (existing.ownerUserId !== userId) {
        // Shared means visible, never editable. Not-found rather than refused:
        // a colleague's private view should not be confirmed to exist.
        throw new ServiceError("not_found", "That view is not here.");
      }
      const [updated] = await ctx.tx
        .update(savedViews)
        .set({
          name: input.name,
          filters: input.filters,
          columns,
          sortKey: input.sortKey ?? null,
          sortDir: input.sortDir ?? null,
          shared: input.shared,
          isDefault: input.isDefault,
          updatedAt: sql`now()`,
        })
        .where(eq(savedViews.id, input.id))
        .returning();
      ctx.setSubject("savedView", updated!.id);
      return updated!;
    }

    const [created] = await ctx.tx
      .insert(savedViews)
      .values({
        entity: input.entity,
        name: input.name,
        filters: input.filters,
        columns,
        sortKey: input.sortKey ?? null,
        sortDir: input.sortDir ?? null,
        ownerUserId: userId,
        shared: input.shared,
        isDefault: input.isDefault,
      })
      .returning();
    ctx.setSubject("savedView", created!.id);
    return created!;
  },
});

export const listViews = defineService({
  name: "views.list",
  summary: "The views for one list: this person's, and what colleagues shared.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ entity: z.string().trim().min(1).max(60) }),
  output: listed(viewRow.extend({ mine: z.boolean() })),
  handler: async (input, ctx) => {
    const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const rows = await ctx.tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.entity, input.entity),
          // Theirs, or anything a colleague deliberately shared. A private view
          // is filtered in the query so it cannot surface anywhere else.
          userId
            ? or(eq(savedViews.ownerUserId, userId), eq(savedViews.shared, true))
            : eq(savedViews.shared, true),
        ),
      )
      .orderBy(asc(savedViews.name))
      .limit(100);
    return rows.map((view) => ({ ...view, mine: view.ownerUserId === userId }));
  },
});

export const removeView = defineService({
  name: "views.remove",
  summary: "Forget a saved view.",
  kind: "mutation",
  // Anybody signed in, because the real gate is per list: `mayUseEntity` below
  // refuses a view of a list this person cannot open. A separate "views" module
  // grant would mean an owner had to hand out a permission for a feature that
  // is really just a bookmark.
  permission: "authenticated",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    const userId = requireUser(ctx.actor);
    const [removed] = await ctx.tx
      .delete(savedViews)
      .where(and(eq(savedViews.id, input.id), eq(savedViews.ownerUserId, userId)))
      .returning({ id: savedViews.id });
    if (!removed) throw new ServiceError("not_found", "That view is not here.");
    ctx.setSubject("savedView", removed.id);
    return removed;
  },
});

/**
 * Which view opens when somebody arrives at a list with no parameters.
 *
 * A separate service from `views.save` because it is a different act: making a
 * colleague's shared view your own default should not require you to be able to
 * edit it. So this writes a default *for this person*, and the row it points at
 * may belong to anybody.
 */
export const defaultView = defineService({
  name: "views.default",
  summary: "The view that opens by default for this person on this list.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ entity: z.string().trim().min(1).max(60) }),
  output: viewRow.nullable(),
  handler: async (input, ctx) => {
    const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    if (!userId) return null;
    const [found] = await ctx.tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.entity, input.entity),
          eq(savedViews.ownerUserId, userId),
          eq(savedViews.isDefault, true),
        ),
      )
      .limit(1);
    return found ?? null;
  },
});

export const setDefaultView = defineService({
  name: "views.setDefault",
  summary: "Open this view first, for me, on this list.",
  kind: "mutation",
  // Anybody signed in, because the real gate is per list: `mayUseEntity` below
  // refuses a view of a list this person cannot open. A separate "views" module
  // grant would mean an owner had to hand out a permission for a feature that
  // is really just a bookmark.
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: id.nullish(), entity: z.string().trim().min(1).max(60) }),
  output: row({ id: uuid.nullable() }),
  handler: async (input, ctx) => {
    const userId = requireUser(ctx.actor);
    knownEntity(input.entity);
    await clearDefault(ctx, input.entity, userId);
    if (!input.id) return { id: null };

    const [view] = await ctx.tx
      .select({ id: savedViews.id, ownerUserId: savedViews.ownerUserId, shared: savedViews.shared })
      .from(savedViews)
      .where(eq(savedViews.id, input.id))
      .limit(1);
    if (!view || (view.ownerUserId !== userId && !view.shared)) {
      throw new ServiceError("not_found", "That view is not here.");
    }
    if (view.ownerUserId !== userId) {
      // Somebody else's shared view. Making it *your* default cannot write to
      // their row, so this keeps a copy of your own — which also means their
      // later edits do not silently change what opens for you.
      const [source] = await ctx.tx
        .select()
        .from(savedViews)
        .where(eq(savedViews.id, input.id))
        .limit(1);
      const [copied] = await ctx.tx
        .insert(savedViews)
        .values({
          entity: source!.entity,
          name: source!.name,
          filters: source!.filters,
          columns: source!.columns,
          sortKey: source!.sortKey,
          sortDir: source!.sortDir,
          ownerUserId: userId,
          // Their copy is not itself re-shared: sharing is a decision its
          // owner makes, and inheriting it would spread a view nobody chose to
          // spread.
          shared: false,
          isDefault: true,
        })
        .returning({ id: savedViews.id });
      ctx.setSubject("savedView", copied!.id);
      return { id: copied!.id };
    }

    await ctx.tx
      .update(savedViews)
      .set({ isDefault: true, updatedAt: sql`now()` })
      .where(eq(savedViews.id, input.id));
    ctx.setSubject("savedView", input.id);
    return { id: input.id };
  },
});

export const listViewEntities = defineService({
  name: "views.entities",
  summary: "The lists a view can be kept of.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(
    row({
      key: z.string(),
      label: z.string(),
      path: z.string(),
      filters: z.array(row({ key: z.string(), label: z.string() })),
      columns: z.array(row({ key: z.string(), label: z.string(), fixed: z.boolean() })),
    }),
  ),
  handler: async (_input, ctx) =>
    viewEntities()
      .filter((entity) => mayUseEntity(ctx.actor, entity))
      .map((entity) => ({
        key: entity.key,
        label: entity.label,
        path: entity.path,
        filters: entity.filters,
        columns: entity.columns.map((column) => ({
          key: column.key,
          label: column.label,
          fixed: column.fixed ?? false,
        })),
      })),
});

/** One default per person per list; the index says so, this keeps it true. */
async function clearDefault(
  ctx: { tx: Tx },
  entity: string,
  userId: string,
): Promise<void> {
  await ctx.tx
    .update(savedViews)
    .set({ isDefault: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(savedViews.entity, entity),
        eq(savedViews.ownerUserId, userId),
        eq(savedViews.isDefault, true),
      ),
    );
}

export default [
  saveView,
  listViews,
  removeView,
  defaultView,
  setDefaultView,
  listViewEntities,
];

