// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pipelines, stages and deals (MASTER.md §4.1, C7.01).
//
// Two rules from §4.1, held here rather than in a screen.
//
// **A deal is optional, and the module is inert until an owner defines a
// stage.** Nothing creates a deal by itself, nothing in core requires one, and
// `crm.installDefaults` exists so an owner who *does* want pipelines gets
// §4.1's default ladder rather than an empty board and a blank form.
//
// **A stage transition is an event, not an UPDATE.** §4.1: transitions "emit
// TimelineEvents, can trigger automations, and power a kanban pipeline view".
// So moving a deal or a contact goes through one service that writes the
// timeline and queues the event, and the board drags through the same door the
// API does.
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import {
  DEAL_STATUSES,
  LIFECYCLE_STAGES,
  PIPELINE_KINDS,
  contactStages,
  deals,
  pipelineStages,
  pipelines,
} from "./schema";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  // The system actor passes: an accepted quote advancing its own deal is
  // elevation from a caller that has already established authority, and
  // refusing it there is the bug C6.09 and C6.13 both hit.
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage pipelines.");
  }
}

const stageRow = row({
  id: uuid,
  pipelineId: uuid,
  name: z.string(),
  position: z.number().int(),
  tone: z.string().nullable(),
  probability: z.number().int().nullable(),
  isWon: z.boolean(),
  isLost: z.boolean(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).nullable(),
});

const pipelineRow = row({
  id: uuid,
  kind: z.enum(PIPELINE_KINDS),
  name: z.string(),
  isDefault: z.boolean(),
  position: z.number().int(),
  archivedAt: timestamp.nullable(),
});

const dealRow = row({
  id: uuid,
  contactId: uuid,
  pipelineId: uuid,
  stageId: uuid,
  title: z.string(),
  valueMinor: z.number().int(),
  currency: z.string().nullable(),
  probability: z.number().int().nullable(),
  expectedCloseOn: z.string().nullable(),
  source: z.string().nullable(),
  ownerUserId: uuid.nullable(),
  quoteId: uuid.nullable(),
  status: z.enum(DEAL_STATUSES),
  lostReason: z.string().nullable(),
  closedAt: timestamp.nullable(),
});

/**
 * §4.1's default ladders, offered rather than assumed.
 *
 * "Subscriber → Lead → Prospect → Customer → Repeat → Advocate, fully
 * editable." Installed on request rather than at boot, because §4.1 is
 * explicit that the module stays inert until an owner defines a stage — a
 * retail instance that never opens a deal should not carry a board.
 */
const DEFAULT_LIFECYCLE: {
  name: string;
  lifecycleStage: (typeof LIFECYCLE_STAGES)[number];
}[] = [
  // Subscriber and Advocate have no coarse equivalent of their own, so they
  // derive the nearest true one: somebody on the list is a lead, and somebody
  // who advocates has bought more than once.
  { name: "Subscriber", lifecycleStage: "lead" },
  { name: "Lead", lifecycleStage: "lead" },
  { name: "Prospect", lifecycleStage: "prospect" },
  { name: "Customer", lifecycleStage: "customer" },
  { name: "Repeat", lifecycleStage: "repeat" },
  { name: "Advocate", lifecycleStage: "repeat" },
];

const DEFAULT_DEAL: { name: string; probability: number; isWon?: boolean; isLost?: boolean }[] = [
  { name: "Enquiry", probability: 10 },
  { name: "Quoted", probability: 40 },
  { name: "Negotiating", probability: 60 },
  { name: "Won", probability: 100, isWon: true },
  { name: "Lost", probability: 0, isLost: true },
];

export const installPipelineDefaults = defineService({
  name: "crm.installDefaults",
  summary: "Set up the standard lifecycle and deal ladders.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({}),
  output: row({ pipelines: z.number().int(), stages: z.number().int() }),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    const existing = await ctx.tx.select({ id: pipelines.id }).from(pipelines).limit(1);
    if (existing.length > 0) {
      // Installing twice would give an owner two "Lead" columns and no way to
      // tell which one their contacts are in.
      throw new ServiceError(
        "conflict",
        "Pipelines are already set up. Edit the stages you have instead.",
      );
    }

    let stages = 0;
    for (const [index, kind] of PIPELINE_KINDS.entries()) {
      const [pipeline] = await ctx.tx
        .insert(pipelines)
        .values({
          kind,
          name: kind === "lifecycle" ? "Lifecycle" : "Sales",
          isDefault: true,
          position: index,
        })
        .returning({ id: pipelines.id });
      const ladder =
        kind === "lifecycle"
          ? DEFAULT_LIFECYCLE.map((stage, position) => ({ ...stage, position }))
          : DEFAULT_DEAL.map((stage, position) => ({ ...stage, position }));
      await ctx.tx
        .insert(pipelineStages)
        .values(ladder.map((stage) => ({ ...stage, pipelineId: pipeline!.id })));
      stages += ladder.length;
    }
    return { pipelines: PIPELINE_KINDS.length, stages };
  },
});

export const listPipelines = defineService({
  name: "crm.listPipelines",
  summary: "The pipelines this business uses, and their stages.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    kind: z.enum(PIPELINE_KINDS).optional(),
    includeArchived: z.boolean().default(false),
  }),
  output: listed(pipelineRow.extend({ stages: listed(stageRow) })),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const found = await ctx.tx
      .select()
      .from(pipelines)
      .where(
        and(
          input.kind ? eq(pipelines.kind, input.kind) : undefined,
          input.includeArchived ? undefined : isNull(pipelines.archivedAt),
        ),
      )
      .orderBy(asc(pipelines.position), asc(pipelines.name));
    if (found.length === 0) return [];
    const stages = await ctx.tx
      .select()
      .from(pipelineStages)
      .where(inArray(pipelineStages.pipelineId, found.map((one) => one.id)))
      .orderBy(asc(pipelineStages.position));
    return found.map((pipeline) => ({
      ...pipeline,
      stages: stages.filter((stage) => stage.pipelineId === pipeline.id),
    }));
  },
});

export const savePipeline = defineService({
  name: "crm.savePipeline",
  summary: "Create or rename a pipeline.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id: id.optional(),
    kind: z.enum(PIPELINE_KINDS),
    name: z.string().trim().min(1).max(80),
    isDefault: z.boolean().default(false),
  }),
  output: pipelineRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.isDefault) {
      // One default per kind, cleared first: the partial unique index would
      // otherwise refuse the write and tell the owner nothing useful.
      await ctx.tx
        .update(pipelines)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(and(eq(pipelines.kind, input.kind), eq(pipelines.isDefault, true)));
    }
    if (input.id) {
      const [updated] = await ctx.tx
        .update(pipelines)
        .set({ name: input.name, isDefault: input.isDefault, updatedAt: sql`now()` })
        .where(eq(pipelines.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "That pipeline is not here.");
      ctx.setSubject("pipeline", updated.id);
      return updated;
    }
    const [created] = await ctx.tx
      .insert(pipelines)
      .values({ kind: input.kind, name: input.name, isDefault: input.isDefault })
      .returning();
    ctx.setSubject("pipeline", created!.id);
    return created!;
  },
});

export const saveStage = defineService({
  name: "crm.saveStage",
  summary: "Add or change a stage on a pipeline.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id: id.optional(),
    pipelineId: id,
    name: z.string().trim().min(1).max(60),
    position: z.number().int().min(0).max(100).optional(),
    tone: z.string().trim().max(30).nullish(),
    probability: z.number().int().min(0).max(100).nullish(),
    isWon: z.boolean().default(false),
    isLost: z.boolean().default(false),
    lifecycleStage: z.enum(LIFECYCLE_STAGES).nullish(),
  }),
  output: stageRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [pipeline] = await ctx.tx
      .select({ id: pipelines.id, kind: pipelines.kind })
      .from(pipelines)
      .where(eq(pipelines.id, input.pipelineId))
      .limit(1);
    if (!pipeline) throw new ServiceError("not_found", "That pipeline is not here.");
    if (pipeline.kind === "lifecycle" && !input.lifecycleStage) {
      // The column that stops the configurable pipeline forking from
      // `contacts.lifecycleStage`. A lifecycle stage with nothing to derive
      // would leave the spine value stale the first time somebody used it.
      throw new ServiceError(
        "validation",
        "Say which lifecycle a contact reaching this stage is at, so reports and price lists stay right.",
      );
    }
    if (input.isWon && input.isLost) {
      throw new ServiceError("validation", "A stage is won or lost, not both.");
    }

    if (input.id) {
      const [updated] = await ctx.tx
        .update(pipelineStages)
        .set({
          name: input.name,
          ...(input.position !== undefined ? { position: input.position } : {}),
          tone: input.tone ?? null,
          probability: input.probability ?? null,
          isWon: input.isWon,
          isLost: input.isLost,
          lifecycleStage: input.lifecycleStage ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(pipelineStages.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "That stage is not here.");
      ctx.setSubject("pipeline", updated.pipelineId);
      return updated;
    }

    const [last] = await ctx.tx
      .select({ position: pipelineStages.position })
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, input.pipelineId))
      .orderBy(desc(pipelineStages.position))
      .limit(1);
    const [created] = await ctx.tx
      .insert(pipelineStages)
      .values({
        pipelineId: input.pipelineId,
        name: input.name,
        position: input.position ?? (last?.position ?? -1) + 1,
        tone: input.tone ?? null,
        probability: input.probability ?? null,
        isWon: input.isWon,
        isLost: input.isLost,
        lifecycleStage: input.lifecycleStage ?? null,
      })
      .returning();
    ctx.setSubject("pipeline", input.pipelineId);
    return created!;
  },
});

export const removeStage = defineService({
  name: "crm.removeStage",
  summary: "Take a stage off a pipeline nothing is sitting in.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [dealsHere] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.stageId, input.id));
    const [contactsHere] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contactStages)
      .where(eq(contactStages.stageId, input.id));
    if ((dealsHere?.count ?? 0) + (contactsHere?.count ?? 0) > 0) {
      // Deleting a stage with things in it would silently move them somewhere
      // nobody chose. Moving them first is the owner's decision to make.
      throw new ServiceError(
        "conflict",
        "Move what is in this stage somewhere else first, then remove it.",
      );
    }
    const [removed] = await ctx.tx
      .delete(pipelineStages)
      .where(eq(pipelineStages.id, input.id))
      .returning({ id: pipelineStages.id });
    if (!removed) throw new ServiceError("not_found", "That stage is not here.");
    return removed;
  },
});

async function stageOf(ctx: ServiceContext, stageId: string) {
  const [stage] = await ctx.tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.id, stageId))
    .limit(1);
  if (!stage) throw new ServiceError("not_found", "That stage is not here.");
  return stage;
}

export const createDeal = defineService({
  name: "crm.createDeal",
  summary: "Open an opportunity worth following.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    contactId: id,
    title: z.string().trim().min(1).max(200),
    pipelineId: id.optional(),
    stageId: id.optional(),
    valueMinor: z.number().int().min(0).default(0),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullish(),
    expectedCloseOn: z.string().date().nullish(),
    source: z.string().trim().max(100).nullish(),
    ownerUserId: id.nullish(),
    quoteId: id.nullish(),
  }),
  output: dealRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "No such contact.");

    // The default pipeline and its first stage, so a deal created by a form or
    // a quote lands somewhere sensible without the caller knowing the board.
    const pipelineId =
      input.pipelineId ??
      (
        await ctx.tx
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(
            and(eq(pipelines.kind, "deal"), eq(pipelines.isDefault, true), isNull(pipelines.archivedAt)),
          )
          .limit(1)
      )[0]?.id;
    if (!pipelineId) {
      // §4.1: the module is inert until an owner defines a stage. Saying so is
      // more use than creating a pipeline they did not ask for.
      throw new ServiceError(
        "conflict",
        "Set up a sales pipeline before opening a deal.",
      );
    }
    const stageId =
      input.stageId ??
      (
        await ctx.tx
          .select({ id: pipelineStages.id })
          .from(pipelineStages)
          .where(eq(pipelineStages.pipelineId, pipelineId))
          .orderBy(asc(pipelineStages.position))
          .limit(1)
      )[0]?.id;
    if (!stageId) {
      throw new ServiceError("conflict", "That pipeline has no stages yet.");
    }

    const [created] = await ctx.tx
      .insert(deals)
      .values({
        contactId: input.contactId,
        pipelineId,
        stageId,
        title: input.title,
        valueMinor: input.valueMinor,
        currency: input.currency ?? null,
        expectedCloseOn: input.expectedCloseOn ?? null,
        source: input.source ?? null,
        ownerUserId: input.ownerUserId ?? null,
        quoteId: input.quoteId ?? null,
      })
      .returning();

    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "deal.opened",
      subjectType: "deal",
      subjectId: created!.id,
      payload: { title: created!.title, valueMinor: created!.valueMinor },
    });
    ctx.setSubject("deal", created!.id);
    ctx.queueEvent("deal.opened", { id: created!.id, contactId: input.contactId });
    return created!;
  },
});

export const moveDeal = defineService({
  name: "crm.moveDeal",
  summary: "Move a deal to another stage, and record that it moved.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    stageId: id,
    /** Required by a stage that means "lost", and refused otherwise. */
    lostReason: z.string().trim().max(500).nullish(),
  }),
  output: dealRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [deal] = await ctx.tx.select().from(deals).where(eq(deals.id, input.id)).limit(1);
    if (!deal) throw new ServiceError("not_found", "That deal is not here.");
    const stage = await stageOf(ctx, input.stageId);
    if (stage.pipelineId !== deal.pipelineId) {
      // Moving between boards would leave the deal's history describing a
      // ladder it is no longer on.
      throw new ServiceError(
        "validation",
        "That stage belongs to a different pipeline.",
      );
    }
    if (stage.isLost && !input.lostReason) {
      // §4.1: the reason is the only thing a lost deal is still worth. Asking
      // at the moment it is lost is the only moment anybody knows it.
      throw new ServiceError("validation", "Say why it was lost.");
    }

    const status = stage.isWon ? "won" : stage.isLost ? "lost" : "open";
    const [moved] = await ctx.tx
      .update(deals)
      .set({
        stageId: stage.id,
        status,
        lostReason: stage.isLost ? (input.lostReason ?? null) : null,
        // Cleared on the way back to open, so a re-opened deal is not
        // permanently stamped with the day it was briefly lost.
        closedAt: status === "open" ? null : new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(deals.id, deal.id))
      .returning();

    await ctx.emitTimeline({
      contactId: deal.contactId,
      eventType: `deal.${status === "open" ? "moved" : status}`,
      subjectType: "deal",
      subjectId: deal.id,
      payload: {
        from: deal.stageId,
        to: stage.id,
        stage: stage.name,
        ...(input.lostReason ? { reason: input.lostReason } : {}),
      },
    });
    ctx.setSubject("deal", deal.id);
    // §4.1: transitions are service-layer events that can trigger automations.
    ctx.queueEvent(`deal.${status === "open" ? "moved" : status}`, {
      id: deal.id,
      contactId: deal.contactId,
      stageId: stage.id,
      stageName: stage.name,
    });
    return moved!;
  },
});

export const updateDeal = defineService({
  name: "crm.updateDeal",
  summary: "Change what a deal says about itself.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    title: z.string().trim().min(1).max(200).optional(),
    valueMinor: z.number().int().min(0).optional(),
    probability: z.number().int().min(0).max(100).nullish(),
    expectedCloseOn: z.string().date().nullish(),
    ownerUserId: id.nullish(),
  }),
  output: dealRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(deals)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.valueMinor !== undefined ? { valueMinor: input.valueMinor } : {}),
        ...(input.probability !== undefined ? { probability: input.probability ?? null } : {}),
        ...(input.expectedCloseOn !== undefined
          ? { expectedCloseOn: input.expectedCloseOn ?? null }
          : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId ?? null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(deals.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That deal is not here.");
    ctx.setSubject("deal", updated.id);
    return updated;
  },
});

export const listDeals = defineService({
  name: "crm.listDeals",
  summary: "The board: every open deal, by stage, with what it is worth.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    pipelineId: id.optional(),
    status: z.enum(DEAL_STATUSES).optional(),
    ownerUserId: id.optional(),
    limit: z.number().int().min(1).max(500).default(300),
  }),
  output: listed(
    dealRow.extend({
      contactName: z.string().nullable(),
      stageName: z.string(),
      /** The stage's odds unless the deal overrides them (§4.1). */
      effectiveProbability: z.number().int(),
      /** Value at those odds, which is what a forecast is made of. */
      weightedMinor: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx
      .select({
        deal: deals,
        contactName: contacts.name,
        stageName: pipelineStages.name,
        stageProbability: pipelineStages.probability,
      })
      .from(deals)
      .innerJoin(contacts, eq(contacts.id, deals.contactId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(
        and(
          input.pipelineId ? eq(deals.pipelineId, input.pipelineId) : undefined,
          input.status ? eq(deals.status, input.status) : undefined,
          input.ownerUserId ? eq(deals.ownerUserId, input.ownerUserId) : undefined,
        ),
      )
      .orderBy(asc(pipelineStages.position), desc(deals.valueMinor))
      .limit(input.limit);

    return rows.map(({ deal, contactName, stageName, stageProbability }) => {
      const effectiveProbability = deal.probability ?? stageProbability ?? 0;
      return {
        ...deal,
        contactName,
        stageName,
        effectiveProbability,
        // Rounded once, from one integer product (§15.4).
        weightedMinor: Math.round((deal.valueMinor * effectiveProbability) / 100),
      };
    });
  },
});

export const moveContactStage = defineService({
  name: "crm.moveContactStage",
  summary: "Move somebody along the lifecycle, and keep the spine in step.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ contactId: id, stageId: id }),
  output: row({ contactId: uuid, stageId: uuid, lifecycleStage: z.string() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const stage = await stageOf(ctx, input.stageId);
    if (!stage.lifecycleStage) {
      throw new ServiceError(
        "validation",
        "That is a deal stage. Contacts move through a lifecycle pipeline.",
      );
    }

    const [before] = await ctx.tx
      .select({ stageId: contactStages.stageId })
      .from(contactStages)
      .where(eq(contactStages.contactId, input.contactId))
      .limit(1);
    await ctx.tx
      .insert(contactStages)
      .values({ contactId: input.contactId, stageId: stage.id, enteredAt: new Date() })
      .onConflictDoUpdate({
        target: contactStages.contactId,
        set: { stageId: stage.id, enteredAt: new Date(), updatedAt: sql`now()` },
      });

    // The derivation, and the only thing that writes the coarse value. The
    // fine stage is the owner's truth; the enum is its projection, and every
    // existing reader — price lists, segments, reports — keeps working.
    await ctx.callAsSystem(getService("contacts.update"), {
      id: input.contactId,
      lifecycleStage: stage.lifecycleStage,
    });

    if (before?.stageId !== stage.id) {
      await ctx.emitTimeline({
        contactId: input.contactId,
        eventType: "contact.stageChanged",
        subjectType: "contact",
        subjectId: input.contactId,
        payload: { stage: stage.name, lifecycleStage: stage.lifecycleStage },
      });
      // §4.1: "entered Prospect → send case-study sequence" is an automation
      // hanging off this event rather than a branch inside this service.
      ctx.queueEvent("contact.stageChanged", {
        contactId: input.contactId,
        stageId: stage.id,
        stageName: stage.name,
      });
    }
    return {
      contactId: input.contactId,
      stageId: stage.id,
      lifecycleStage: stage.lifecycleStage,
    };
  },
});

export const lifecycleBoard = defineService({
  name: "crm.lifecycleBoard",
  summary: "Who is at which stage of the lifecycle.",
  kind: "query",
  permission: "scoped",
  input: z.object({ pipelineId: id.optional(), limit: z.number().int().min(1).max(500).default(300) }),
  output: listed(
    row({
      contactId: uuid,
      contactName: z.string(),
      stageId: uuid,
      stageName: z.string(),
      enteredAt: timestamp,
    }),
  ),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    return ctx.tx
      .select({
        contactId: contactStages.contactId,
        contactName: contacts.name,
        stageId: contactStages.stageId,
        stageName: pipelineStages.name,
        enteredAt: contactStages.enteredAt,
      })
      .from(contactStages)
      .innerJoin(contacts, eq(contacts.id, contactStages.contactId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, contactStages.stageId))
      .where(input.pipelineId ? eq(pipelineStages.pipelineId, input.pipelineId) : undefined)
      .orderBy(asc(pipelineStages.position), asc(contacts.name))
      .limit(input.limit);
  },
});

/**
 * What a merge means for a deal (CLAUDE.md's non-negotiable).
 *
 * Unconditional. An opportunity belongs to whoever the surviving record is,
 * and one pointing at a contact that no longer exists is revenue nobody is
 * following up.
 */
registerContactReference({
  table: "deals",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(deals).set({ contactId: survivingId }).where(eq(deals.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: deals.id, contactId: deals.contactId })
      .from(deals)
      .where(inArray(deals.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((deal) => deal.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(deals)
        .set({ contactId: duplicateId })
        .where(inArray(deals.id, moved.map((deal) => deal.id)));
    }
  },
});

/**
 * What a merge means for a lifecycle position.
 *
 * The surviving record keeps its own stage, and the duplicate's row is dropped
 * rather than moved: two people merging into one are at one stage, and the
 * survivor's is the one somebody chose most recently. Copying the duplicate's
 * over would silently move them backwards down the ladder.
 */
registerContactReference({
  table: "contact_stages",
  repoint: async (tx, duplicateId, survivingId) => {
    const [survivor] = await tx
      .select({ contactId: contactStages.contactId })
      .from(contactStages)
      .where(eq(contactStages.contactId, survivingId))
      .limit(1);
    if (survivor) {
      await tx.delete(contactStages).where(eq(contactStages.contactId, duplicateId));
      return;
    }
    await tx
      .update(contactStages)
      .set({ contactId: survivingId })
      .where(eq(contactStages.contactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select()
      .from(contactStages)
      .where(inArray(contactStages.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z
      .array(z.object({ contactId: z.string().uuid(), stageId: z.string().uuid() }))
      .parse(beforeState)
      .filter((entry) => entry.contactId === duplicateId);
    for (const entry of rows) {
      await tx
        .insert(contactStages)
        .values({ contactId: entry.contactId, stageId: entry.stageId })
        .onConflictDoNothing();
    }
  },
});

/**
 * What a deal means for the person's own data (§30).
 *
 * The opportunity survives and the person goes. A pipeline is the business's
 * own record of what it pursued and what it won — its forecast, its win rate,
 * its history — and deleting it would take that with the customer's data. The
 * title goes, because it is what the business wrote about them.
 */
registerContactPrivacySource({
  scope: "contact.deals",
  tables: ["deals", "contact_stages"],
  exportData: async (tx, contactId) => ({
    deals: await tx
      .select()
      .from(deals)
      .where(eq(deals.contactId, contactId))
      .orderBy(asc(deals.createdAt)),
    stage: await tx
      .select()
      .from(contactStages)
      .where(eq(contactStages.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(deals)
      .set({ title: "Opportunity", lostReason: null, source: null, updatedAt: sql`now()` })
      .where(eq(deals.contactId, contactId))
      .returning({ id: deals.id });
    await tx.delete(contactStages).where(eq(contactStages.contactId, contactId));
    return { affected: rows.length };
  },
});

export default [
  installPipelineDefaults,
  listPipelines,
  savePipeline,
  saveStage,
  removeStage,
  createDeal,
  moveDeal,
  updateDeal,
  listDeals,
  moveContactStage,
  lifecycleBoard,
];
