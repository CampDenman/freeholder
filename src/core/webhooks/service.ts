// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Outbound webhooks (MASTER.md Â§11, Â§28).
//
// Owner-only throughout. A subscription is a standing instruction to send this
// business's events to somebody else's server, which is a data-sharing
// decision rather than a setting.
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { db } from "@/core/db";
import { violates } from "@/core/db/errors";
import { enqueueJob } from "@/core/jobs";
import { webhookDeliveries, webhookSubscriptions } from "@/core/webhooks/schema";
import {
  assertDeliverableUrl,
  matches,
  newSecret,
} from "@/core/webhooks/sign";
import { defineService, redact, ServiceError, type Actor } from "@/core/service";

const webhookListRow = row({
  id: uuid,
  name: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  status: z.enum(["active", "paused"]),
  pausedReason: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastDeliveryAt: timestamp.nullable(),
  createdAt: timestamp,
});

const webhookRow = webhookListRow.extend({
  secret: z.string(),
  createdBy: uuid.nullable(),
  updatedAt: timestamp,
});

const deliveryRow = row({
  id: uuid,
  subscriptionId: uuid,
  eventName: z.string(),
  status: z.enum(["pending", "sending", "succeeded", "failed"]),
  attempts: z.number().int(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  nextAttemptAt: timestamp,
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
});

/** An event name, a family, or everything. */
const pattern = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(\*|[a-z][a-zA-Z0-9]*\.(\*|[a-zA-Z0-9]+))$/, {
    message: 'use an event name like "contact.created", a group like "contact.*", or "*"',
  });

/**
 * A key must not be able to point the business's events at an address of its
 * choosing â€” that is exfiltration wearing configuration's clothes, and it
 * would be invisible in the audit trail as anything worse than "a setting
 * changed". Same reasoning as apikeys refusing agents.
 */
function refuseAgents(actor: Actor, verb: string): void {
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      `An API key cannot ${verb} webhooks. Sign in as the owner to manage them.`,
    );
  }
}

export const listWebhooks = defineService({
  name: "webhooks.list",
  summary: "Every webhook this site sends events to.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(webhookListRow),
  handler: async (_input, ctx) =>
    ctx.tx
      .select({
        id: webhookSubscriptions.id,
        name: webhookSubscriptions.name,
        url: webhookSubscriptions.url,
        events: webhookSubscriptions.events,
        status: webhookSubscriptions.status,
        pausedReason: webhookSubscriptions.pausedReason,
        consecutiveFailures: webhookSubscriptions.consecutiveFailures,
        lastDeliveryAt: webhookSubscriptions.lastDeliveryAt,
        createdAt: webhookSubscriptions.createdAt,
      })
      .from(webhookSubscriptions)
      .orderBy(desc(webhookSubscriptions.createdAt)),
});

export const createWebhook = defineService({
  name: "webhooks.create",
  summary: "Send this site's events to another server.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    name: z.string().min(1).max(80),
    url: z.string().min(1).max(2000),
    events: z.array(pattern).min(1).max(50),
  }),
  output: webhookRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "create");
    assertDeliverableUrl(input.url);

    const secret = newSecret();
    const [row] = await ctx.tx
      .insert(webhookSubscriptions)
      .values({
        name: input.name,
        url: input.url,
        events: input.events,
        secret,
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "webhook_subscriptions_name_idx")) {
          throw new ServiceError(
            "conflict",
            `There is already a webhook called "${input.name}".`,
          );
        }
        throw error;
      });

    ctx.setSubject("webhook", row!.id);
    ctx.queueEvent("webhook.created", { id: row!.id, name: row!.name });
    return row!;
  },
});

export const updateWebhook = defineService({
  name: "webhooks.update",
  summary: "Change a webhook, or turn it back on.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    id: z.uuid(),
    name: z.string().min(1).max(80).optional(),
    url: z.string().min(1).max(2000).optional(),
    events: z.array(pattern).min(1).max(50).optional(),
    status: z.enum(["active", "paused"]).optional(),
  }),
  output: webhookRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "change");
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "webhooks.update: nothing to change");
    }
    if (changes.url) assertDeliverableUrl(changes.url);

    const [row] = await ctx.tx
      .update(webhookSubscriptions)
      .set({
        ...changes,
        // Turning one back on clears the reason it stopped and the count that
        // stopped it â€” otherwise a single further failure pauses it again and
        // the owner never gets a real second chance.
        ...(changes.status === "active"
          ? { pausedReason: null, consecutiveFailures: 0 }
          : {}),
      })
      .where(eq(webhookSubscriptions.id, id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such webhook.");

    ctx.setSubject("webhook", id);
    ctx.queueEvent("webhook.updated", { id, name: row.name });
    return row;
  },
});

/**
 * A new signing secret.
 *
 * Separate from `update` because it is the one change that breaks the
 * receiver until they are told: every delivery after this is signed with
 * something they do not have yet.
 */
export const rotateWebhookSecret = defineService({
  name: "webhooks.rotateSecret",
  summary: "Issue a new signing secret for a webhook.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: z.object({
    id: uuid,
    name: z.string(),
    secret: z.string(),
  }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "change");
    const secret = newSecret();
    const [row] = await ctx.tx
      .update(webhookSubscriptions)
      .set({ secret })
      .where(eq(webhookSubscriptions.id, input.id))
      .returning({ id: webhookSubscriptions.id, name: webhookSubscriptions.name });
    if (!row) throw new ServiceError("not_found", "No such webhook.");

    ctx.setSubject("webhook", input.id);
    ctx.queueEvent("webhook.updated", { id: input.id, name: row.name });
    return { ...row, secret };
  },
});

/**
 * The signing secret, shown on request rather than in the list.
 *
 * A receiver needs it to verify anything, so it has to be readable â€” unlike an
 * API key, which only ever has to be *recognised*. Keeping it out of the list
 * response means it is not sitting in the markup of a screen an owner leaves
 * open, and asking for it is an auditable act.
 */
export const revealWebhookSecret = defineService({
  name: "webhooks.secret",
  summary: "Show a webhook's signing secret.",
  kind: "query",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: z.object({ secret: z.string() }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An API key cannot read webhook secrets.",
      );
    }
    const [row] = await ctx.tx
      .select({ secret: webhookSubscriptions.secret })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "No such webhook.");
    ctx.setSubject("webhook", input.id);
    return row;
  },
});

export const deleteWebhook = defineService({
  name: "webhooks.remove",
  writeClass: "destructive",
  summary: "Stop sending events to a server.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid, name: z.string() }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "remove");
    const [row] = await ctx.tx
      .delete(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, input.id))
      .returning({ id: webhookSubscriptions.id, name: webhookSubscriptions.name });
    if (!row) throw new ServiceError("not_found", "No such webhook.");

    ctx.setSubject("webhook", input.id);
    ctx.queueEvent("webhook.deleted", { id: input.id, name: row.name });
    return row;
  },
});

export const listDeliveries = defineService({
  name: "webhooks.deliveries",
  summary: "What this site has tried to send, and how it went.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    subscriptionId: z.uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(deliveryRow),
  handler: async (input, ctx) =>
    ctx.tx
      .select({
        id: webhookDeliveries.id,
        subscriptionId: webhookDeliveries.subscriptionId,
        eventName: webhookDeliveries.eventName,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        responseStatus: webhookDeliveries.responseStatus,
        error: webhookDeliveries.error,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        createdAt: webhookDeliveries.createdAt,
        completedAt: webhookDeliveries.completedAt,
      })
      .from(webhookDeliveries)
      .where(
        input.subscriptionId
          ? eq(webhookDeliveries.subscriptionId, input.subscriptionId)
          : undefined,
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(input.limit),
});

/**
 * Send a delivery an owner can watch.
 *
 * The only way to find out whether an address, a firewall and a receiver's
 * signature check all work is to send one â€” and doing that by waiting for a
 * real event means testing in production with somebody's actual data.
 */
export const inspectDelivery = defineService({
  name: "webhooks.inspectDelivery",
  summary: "One delivery, with a redacted copy of what was sent.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: deliveryRow.extend({
    payload: z.unknown(),
    responseBody: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "No such delivery.");
    ctx.setSubject("webhook", row.subscriptionId);
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      eventName: row.eventName,
      status: row.status,
      attempts: row.attempts,
      responseStatus: row.responseStatus,
      error: row.error,
      nextAttemptAt: row.nextAttemptAt,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      payload: redact(row.payload),
      responseBody: row.responseBody,
    };
  },
});

export const replayDelivery = defineService({
  name: "webhooks.replay",
  summary: "Queue one delivery again with the payload that was stored.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: z.object({ deliveryId: uuid, jobId: z.string() }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "replay");
    const [row] = await ctx.tx
      .update(webhookDeliveries)
      .set({
        status: "pending",
        nextAttemptAt: new Date(),
        error: null,
        responseStatus: null,
        responseBody: null,
        completedAt: null,
      })
      .where(eq(webhookDeliveries.id, input.id))
      .returning({
        id: webhookDeliveries.id,
        subscriptionId: webhookDeliveries.subscriptionId,
      });
    if (!row) throw new ServiceError("not_found", "No such delivery.");
    const queued = await ctx.queueJob(
      "core.deliverWebhooks",
      {},
      { idempotencyKey: `webhook-replay:${row.id}:${Date.now()}` },
    );
    ctx.setSubject("webhook", row.subscriptionId);
    ctx.queueEvent("webhook.replayed", { id: row.id });
    return { deliveryId: row.id, jobId: queued.id };
  },
});

export const rotateWebhookEndpoint = defineService({
  name: "webhooks.rotateEndpoint",
  summary: "Point a webhook at a new URL and issue a new signing secret.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    id: z.uuid(),
    url: z.string().min(1).max(2000),
  }),
  output: webhookRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "rotate");
    assertDeliverableUrl(input.url);
    const secret = newSecret();
    const [row] = await ctx.tx
      .update(webhookSubscriptions)
      .set({ url: input.url, secret, consecutiveFailures: 0, pausedReason: null, status: "active" })
      .where(eq(webhookSubscriptions.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such webhook.");
    ctx.setSubject("webhook", input.id);
    ctx.queueEvent("webhook.updated", { id: input.id, name: row.name });
    return row;
  },
});

export const testWebhook = defineService({
  name: "webhooks.test",
  summary: "Send a test event to a webhook now.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    deliveryId: uuid,
    jobId: z.string(),
  }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "test");
    const [subscription] = await ctx.tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, input.id))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "No such webhook.");

    const [delivery] = await ctx.tx
      .insert(webhookDeliveries)
      .values({
        subscriptionId: subscription.id,
        eventName: "webhook.test",
        payload: { message: "This is a test delivery from your Freeholder site." },
      })
      .returning({ id: webhookDeliveries.id });

    const queued = await ctx.queueJob(
      "core.deliverWebhooks",
      {},
      { idempotencyKey: `webhook-test:${delivery!.id}` },
    );

    ctx.setSubject("webhook", input.id);
    return { deliveryId: delivery!.id, jobId: queued.id };
  },
});

/**
 * Queue a delivery for every subscription that wants this event.
 *
 * Called by the bus for *every* committed event (see core/events). It writes
 * rows and returns; the sending happens in a job. That split is the whole
 * design: a mutation's response time must not depend on somebody else's
 * server being awake, and a delivery must survive this process dying between
 * the commit and the request.
 */
export async function fanOut(
  eventName: string,
  payload: unknown,
  outboxEventId?: string,
): Promise<number> {
  // The webhook system does not report on itself. A subscription to `*` would
  // otherwise be told every time a webhook was created or changed â€” including
  // its own creation, which is self-referential noise â€” and, more seriously,
  // it is the shape of a feedback loop: the day something emits an event when
  // a delivery fails, a `*` subscription would generate a delivery about the
  // failed delivery, forever. Cheap insurance against a bug nobody would spot
  // until it filled a table.
  if (eventName.startsWith("webhook.")) return 0;

  const subscriptions = await db()
    .select({
      id: webhookSubscriptions.id,
      events: webhookSubscriptions.events,
    })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.status, "active"));

  const wanted = subscriptions.filter((subscription) =>
    matches(subscription.events, eventName),
  );
  if (wanted.length === 0) return 0;

  await db().transaction(async (tx) => {
    const created = await tx
      .insert(webhookDeliveries)
      .values(
        wanted.map((subscription) => ({
          subscriptionId: subscription.id,
          outboxEventId,
          eventName,
          payload: (payload ?? {}) as Record<string, unknown>,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });

    if (created.length === 0) return;

    // The delivery rows and their immediate nudge are one commit. If queue
    // storage is unavailable the outbox listener fails and retries instead of
    // leaving deliveries that wait silently for the next minute tick.
    await enqueueJob(tx, "core.deliverWebhooks", {}, {
      idempotencyKey: `webhook-fanout:${outboxEventId ?? created[0]!.id}`,
    });
  });

  return wanted.length;
}

export default [
  listWebhooks,
  createWebhook,
  updateWebhook,
  rotateWebhookSecret,
  revealWebhookSecret,
  deleteWebhook,
  listDeliveries,
  inspectDelivery,
  replayDelivery,
  rotateWebhookEndpoint,
  testWebhook,
];
