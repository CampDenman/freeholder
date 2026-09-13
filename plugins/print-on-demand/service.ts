// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { podProvider } from "./adapter";
import { podJobs, podSkuMaps } from "./schema";

const jobRow = row({
  id: uuid,
  sku: z.string(),
  provider: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lastError: z.string().nullable(),
  orderId: uuid.nullable(),
  orderItemId: uuid.nullable(),
  fulfillmentId: uuid.nullable(),
});

const mapRow = row({
  id: uuid,
  sku: z.string(),
  provider: z.string(),
  providerProductId: z.string(),
});

type CatalogOrder = {
  order: { id: string; status: string; shippingAddress: unknown };
  lines: Array<{
    id: string;
    quantity: number;
    snapshot: Record<string, unknown> | null;
  }>;
};

type CatalogFulfillment = {
  fulfillment: { id: string; status: string };
  items: Array<{ orderItemId: string }>;
};

function snapshotSku(snapshot: Record<string, unknown> | null): string | null {
  const sku = snapshot?.sku;
  return typeof sku === "string" && sku.length > 0 ? sku : null;
}

function requiresShipping(snapshot: Record<string, unknown> | null): boolean {
  return snapshot?.requiresShipping !== false;
}

async function catalogCall<T>(
  ctx: ServiceContext,
  name: string,
  input: unknown,
): Promise<T> {
  return ctx.call(getService(name), input) as Promise<T>;
}

async function existingFulfillmentId(
  ctx: ServiceContext,
  orderId: string,
  orderItemId: string,
): Promise<string | null> {
  const rows = await catalogCall<Array<{ id: string; status: string }>>(
    ctx,
    "catalog.listFulfillments",
    { orderId },
  );
  for (const row of rows) {
    if (row.status === "failed" || row.status === "returned") continue;
    const detail = await catalogCall<CatalogFulfillment>(ctx, "catalog.getFulfillment", {
      id: row.id,
    });
    if (detail.items.some((item) => item.orderItemId === orderItemId)) {
      return detail.fulfillment.id;
    }
  }
  return null;
}

async function openFulfillment(
  ctx: ServiceContext,
  orderId: string,
  orderItemId: string,
  quantity: number,
): Promise<string> {
  const existing = await existingFulfillmentId(ctx, orderId, orderItemId);
  if (existing) return existing;
  try {
    const created = await catalogCall<CatalogFulfillment>(ctx, "catalog.createFulfillment", {
      orderId,
      items: [{ orderItemId, quantity }],
    });
    return created.fulfillment.id;
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== "validation") throw error;
    const reused = await existingFulfillmentId(ctx, orderId, orderItemId);
    if (!reused) throw error;
    return reused;
  }
}

const claimSubmit = defineService({
  name: "printOnDemand.claimSubmit",
  summary: "Lock a queued or failed print job before talking to the provider.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({ jobId: z.string().uuid() }),
  output: row({
    jobId: uuid,
    sku: z.string(),
    provider: z.string(),
    payload: z.record(z.string(), z.unknown()),
  }),
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1);
    if (!job) throw new ServiceError("not_found", "No such print job.");
    if (job.status === "submitted") {
      throw new ServiceError("conflict", "That print job is already with the provider.");
    }
    if (job.status === "submitting") {
      throw new ServiceError("conflict", "That print job is already being submitted.");
    }
    await ctx.tx
      .update(podJobs)
      .set({ status: "submitting", lastError: null })
      .where(eq(podJobs.id, job.id));
    return {
      jobId: job.id,
      sku: job.sku,
      provider: job.provider,
      payload: (job.payload ?? {}) as Record<string, unknown>,
    };
  },
});

const applySubmit = defineService({
  name: "printOnDemand.applySubmit",
  summary: "Record the print provider's response on the job and the catalog fulfillment.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    jobId: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1);
    if (!job) throw new ServiceError("not_found", "No such print job.");
    if (input.externalRef) {
      await ctx.tx
        .update(podJobs)
        .set({ status: "submitted", externalRef: input.externalRef, lastError: null })
        .where(eq(podJobs.id, job.id));
      if (job.fulfillmentId) {
        await catalogCall(ctx, "catalog.shipFulfillment", {
          id: job.fulfillmentId,
          carrier: job.provider.slice(0, 80),
          trackingNumber: input.externalRef.slice(0, 120),
        });
      }
      ctx.queueEvent("printOnDemand.submitted", {
        id: job.id,
        sku: job.sku,
        orderId: job.orderId,
        fulfillmentId: job.fulfillmentId,
      });
    } else {
      await ctx.tx
        .update(podJobs)
        .set({
          status: "failed",
          lastError: input.lastError ?? "The print provider could not take that job.",
        })
        .where(eq(podJobs.id, job.id));
    }
    return { ok: true as const };
  },
});

export const mapPodSku = defineService({
  name: "printOnDemand.mapSku",
  summary: "Map a catalog SKU onto a print provider product.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    sku: z.string().trim().min(1).max(180),
    provider: z.string().trim().min(1).max(80),
    providerProductId: z.string().trim().min(1).max(200),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
  output: mapRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(podSkuMaps)
      .where(and(eq(podSkuMaps.sku, input.sku), eq(podSkuMaps.provider, input.provider)))
      .limit(1);
    if (existing) {
      const [updated] = await ctx.tx
        .update(podSkuMaps)
        .set({
          providerProductId: input.providerProductId,
          payload: input.payload,
        })
        .where(eq(podSkuMaps.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await ctx.tx.insert(podSkuMaps).values(input).returning();
    ctx.setSubject("pod_sku_map", created!.id);
    return created!;
  },
});

export const listPodMaps = defineService({
  name: "printOnDemand.listMaps",
  summary: "Catalog SKUs mapped onto print provider products.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(mapRow),
  handler: (_input, ctx) => ctx.tx.select().from(podSkuMaps).orderBy(desc(podSkuMaps.createdAt)),
});

export const queuePodJob = defineService({
  name: "printOnDemand.queue",
  summary: "Queue a print-on-demand job. Fulfillment still goes through catalog orders.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    sku: z.string().min(1),
    provider: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
  output: jobRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx.insert(podJobs).values(input).returning();
    ctx.setSubject("pod_job", created!.id);
    ctx.queueEvent("printOnDemand.queued", { id: created!.id, sku: created!.sku });
    return created!;
  },
});

export const queueOrderLines = defineService({
  name: "printOnDemand.queueOrder",
  summary: "Queue a print job for each mapped catalog line on a paid order.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ orderId: z.string().uuid() }),
  output: listed(jobRow),
  handler: async (input, ctx) => {
    const detail = await catalogCall<CatalogOrder>(ctx, "catalog.getOrder", { id: input.orderId });
    if (
      detail.order.status === "pending_payment" ||
      detail.order.status === "cancelled" ||
      detail.order.status === "refunded"
    ) {
      throw new ServiceError("conflict", "Only a paid order can be sent to the print provider.");
    }
    const maps = await ctx.tx.select().from(podSkuMaps);
    const bySku = new Map(maps.map((row) => [row.sku, row]));
    const queued = [];
    for (const line of detail.lines) {
      const sku = snapshotSku(line.snapshot);
      if (!sku || !requiresShipping(line.snapshot)) continue;
      const mapped = bySku.get(sku);
      if (!mapped) continue;
      const [existing] = await ctx.tx
        .select()
        .from(podJobs)
        .where(eq(podJobs.orderItemId, line.id))
        .limit(1);
      if (existing) {
        queued.push(existing);
        continue;
      }
      const fulfillmentId = await openFulfillment(ctx, detail.order.id, line.id, line.quantity);
      const payload = {
        ...((mapped.payload ?? {}) as Record<string, unknown>),
        providerProductId: mapped.providerProductId,
        quantity: line.quantity,
        orderId: detail.order.id,
        orderItemId: line.id,
        shippingAddress: detail.order.shippingAddress,
      };
      try {
        const [created] = await ctx.tx
          .insert(podJobs)
          .values({
            sku,
            provider: mapped.provider,
            payload,
            orderId: detail.order.id,
            orderItemId: line.id,
            fulfillmentId,
          })
          .returning();
        ctx.setSubject("pod_job", created!.id);
        ctx.queueEvent("printOnDemand.queued", {
          id: created!.id,
          sku,
          orderId: detail.order.id,
          fulfillmentId,
        });
        queued.push(created!);
      } catch (error) {
        if (!isUniqueViolation(error, "pod_jobs_order_item_idx")) throw error;
        const [raced] = await ctx.tx
          .select()
          .from(podJobs)
          .where(eq(podJobs.orderItemId, line.id))
          .limit(1);
        if (raced) queued.push(raced);
      }
    }
    return queued;
  },
});

export const submitPodJob = defineOrchestratedService({
  name: "printOnDemand.submit",
  summary: "Send a queued print job to the provider, or retry a failed one.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ jobId: z.string().uuid() }),
  output: jobRow,
  handler: async (input) => {
    const claimed = await claimSubmit.call(input, { kind: "system" });
    try {
      const result = await podProvider().submit({
        sku: claimed.sku,
        provider: claimed.provider,
        payload: claimed.payload,
      });
      await applySubmit.call(
        { jobId: claimed.jobId, externalRef: result.externalRef },
        { kind: "system" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The print provider could not take that job.";
      await applySubmit.call(
        { jobId: claimed.jobId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listPodJobs.call({}, { kind: "system" })).find((row) => row.id === claimed.jobId);
    if (!found) throw new ServiceError("not_found", "No such print job.");
    return found;
  },
});

export const listPodJobs = defineService({
  name: "printOnDemand.list",
  summary: "Queued print-on-demand jobs.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(jobRow),
  handler: (_input, ctx) => ctx.tx.select().from(podJobs).orderBy(desc(podJobs.createdAt)),
});

/** Paid catalog lines whose SKU is mapped here become print jobs after commit. */
export async function onOrderPaid(payload: unknown): Promise<void> {
  const orderId = (payload as { orderId?: string } | null)?.orderId;
  if (!orderId) return;
  const jobs = await queueOrderLines.call({ orderId }, { kind: "system" });
  for (const job of jobs) {
    if (job.status === "queued" || job.status === "failed") {
      await submitPodJob.call({ jobId: job.id }, { kind: "system" });
    }
  }
}

export default [
  mapPodSku,
  listPodMaps,
  queuePodJob,
  queueOrderLines,
  claimSubmit,
  applySubmit,
  submitPodJob,
  listPodJobs,
];
