// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Human-only inspection and recovery for event delivery dead letters (C1.11).
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  outboxEventDeliveries,
  outboxEvents,
} from "@/core/events/schema";
import { resetOutboxEventForReplay } from "@/core/events/outbox";
import {
  defineService,
  redact,
  ServiceError,
  type Actor,
} from "@/core/service";

const eventStatus = z.enum(["pending", "dispatched", "dead_letter"]);

function requireHumanOrSystem(actor: Actor): void {
  if (actor.kind === "user" || actor.kind === "system") return;
  throw new ServiceError(
    "permission",
    "Sign in as a staff member with platform access to inspect event delivery.",
  );
}

export const outboxSummary = defineService({
  name: "platform.outboxSummary",
  summary: "Count pending, delivered, and dead-lettered outbox events.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    const rows = await ctx.tx
      .select({
        status: outboxEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(outboxEvents)
      .groupBy(outboxEvents.status);
    const summary = { pending: 0, dispatched: 0, deadLetters: 0 };
    for (const row of rows) {
      if (row.status === "pending") summary.pending = row.count;
      if (row.status === "dispatched") summary.dispatched = row.count;
      if (row.status === "dead_letter") summary.deadLetters = row.count;
    }
    return summary;
  },
});

export const listOutboxEvents = defineService({
  name: "platform.listOutboxEvents",
  summary: "List retained outbox events for human operations and recovery.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: eventStatus.default("dead_letter"),
    eventName: z.string().trim().min(1).max(160).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    const where = input.eventName
      ? and(
          eq(outboxEvents.status, input.status),
          eq(outboxEvents.eventName, input.eventName),
        )
      : eq(outboxEvents.status, input.status);
    const [items, totals] = await Promise.all([
      ctx.tx
        .select({
          id: outboxEvents.id,
          eventName: outboxEvents.eventName,
          status: outboxEvents.status,
          attempts: outboxEvents.attempts,
          replayCount: outboxEvents.replayCount,
          nextAttemptAt: outboxEvents.nextAttemptAt,
          deadLetteredAt: outboxEvents.deadLetteredAt,
          lastError: outboxEvents.lastError,
          createdAt: outboxEvents.createdAt,
        })
        .from(outboxEvents)
        .where(where)
        .orderBy(desc(outboxEvents.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      ctx.tx
        .select({ total: sql<number>`count(*)::int` })
        .from(outboxEvents)
        .where(where),
    ]);
    return { items, total: totals[0]?.total ?? 0 };
  },
});

export const getOutboxEvent = defineService({
  name: "platform.getOutboxEvent",
  summary: "Inspect one retained event and its per-listener receipts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    const [event] = await ctx.tx
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, input.id))
      .limit(1);
    if (!event) {
      throw new ServiceError("not_found", "No retained outbox event has that ID.");
    }
    const deliveries = await ctx.tx
      .select()
      .from(outboxEventDeliveries)
      .where(eq(outboxEventDeliveries.eventId, input.id))
      .orderBy(outboxEventDeliveries.listenerId);
    return {
      ...event,
      payload: redact(event.payload),
      deliveries,
    };
  },
});

export const replayOutboxEvent = defineService({
  name: "platform.replayOutboxEvent",
  summary: "Replay only unfinished listeners for one outbox dead letter.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.uuid(), confirm: z.literal("REPLAY") }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    const replayCount = await resetOutboxEventForReplay(ctx.tx, input.id);
    if (replayCount === undefined) {
      throw new ServiceError(
        "conflict",
        "Only a retained outbox dead letter can be replayed.",
      );
    }
    const queued = await ctx.queueJob(
      "core.dispatchOutboxEvent",
      { id: input.id },
      { idempotencyKey: `outbox-replay:${input.id}:${replayCount}` },
    );
    ctx.setSubject("outbox_event", input.id);
    ctx.queueEvent("outbox.replayed", {
      id: input.id,
      replayCount,
      jobId: queued.id,
    });
    return { replayed: true, replayCount, jobId: queued.id };
  },
});

export default [
  outboxSummary,
  listOutboxEvents,
  getOutboxEvent,
  replayOutboxEvent,
];
