// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import { env } from "@/core/env";
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

attachPluginContactColumn({ table: "pod_jobs", schema: podJobs, label: "A print fulfillment job", scope: "plugins.print-on-demand" });
const PROVIDER_LEASE_MS = 10 * 60 * 1000;
const shipmentRow = z.object({ carrier: z.string(), number: z.string(), url: z.string().nullable(), deliveredAt: z.string().nullable() });
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
  providerStatus: z.string().nullable(),
  providerLeaseExpiresAt: timestamp.nullable(),
  shipments: listed(shipmentRow),
});

const mapRow = row({
  id: uuid,
  sku: z.string(),
  provider: z.string(),
  providerProductId: z.string(),
  providerVariantId: z.number().int().nullable(),
});

type CatalogOrder = {
  order: { id: string; contactId: string; status: string; shippingAddress: unknown };
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
    externalId: z.string(),
    accountId: z.string().nullable(),
    leaseToken: uuid,
  }),
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1).for("update");
    if (!job) throw new ServiceError("not_found", "No such print job.");
    if (job.status === "submitted" || job.status === "fulfilled") {
      throw new ServiceError("conflict", "That print job is already with the provider.");
    }
    if (job.status === "submitting" && job.providerLeaseExpiresAt && job.providerLeaseExpiresAt > new Date()) {
      throw new ServiceError("conflict", "That print job is already being submitted.");
    }
    const leaseToken = randomUUID();
    const accountId = job.providerAccountId ?? (job.provider === "printify" ? env().PRINTIFY_SHOP_ID ?? null : null);
    await ctx.tx
      .update(podJobs)
      .set({ status: "submitting", lastError: null, providerLeaseToken: leaseToken,
        providerAccountId: accountId,
        providerLeaseExpiresAt: new Date(Date.now() + PROVIDER_LEASE_MS) })
      .where(eq(podJobs.id, job.id));
    return {
      jobId: job.id,
      sku: job.sku,
      provider: job.provider,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      externalId: `freeholder:pod:${job.orderItemId ?? job.id}`,
      accountId,
      leaseToken,
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
    leaseToken: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1).for("update");
    if (!job) throw new ServiceError("not_found", "No such print job.");
    if (job.providerLeaseToken !== input.leaseToken || !job.providerLeaseExpiresAt || job.providerLeaseExpiresAt <= new Date()) {
      throw new ServiceError("conflict", "That print submission no longer owns its job.");
    }
    if (input.externalRef) {
      await ctx.tx
        .update(podJobs)
        .set({ status: "submitted", externalRef: input.externalRef, lastError: null,
          providerLeaseToken: null, providerLeaseExpiresAt: null })
        .where(eq(podJobs.id, job.id));
      // C3.13: provider acceptance is not evidence of shipment. Keep the
      // fulfillment open until actual carrier/tracking evidence arrives.
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
          providerLeaseToken: null, providerLeaseExpiresAt: null,
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
    providerVariantId: z.number().int().positive().optional(),
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
          providerVariantId: input.providerVariantId ?? existing.providerVariantId,
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
    // Serialize first-time queueing as well as retries: a unique job index
    // alone cannot prevent two workers from opening competing fulfillments.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pod-order:${input.orderId}`}, 0))`);
    const detail = await catalogCall<CatalogOrder>(ctx, "catalog.getOrder", { id: input.orderId });
    if (
      detail.order.status === "pending_payment" ||
      detail.order.status === "cancelled" ||
      detail.order.status === "refunded"
    ) {
      throw new ServiceError("conflict", "Only a paid order can be sent to the print provider.");
    }
    const customer = await ctx.callAsSystem(getService("contacts.get"), { id: detail.order.contactId }) as { email: string | null; name: string } | null;
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
        providerVariantId: mapped.providerVariantId ?? (mapped.payload as Record<string, unknown> | null)?.providerVariantId,
        buyerEmail: customer?.email,
        buyerName: customer?.name,
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
            contactId: detail.order.contactId,
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
  writeClass: "money",
  input: z.object({ jobId: z.string().uuid() }),
  output: jobRow,
  handler: async (input) => {
    const claimed = await claimSubmit.call(input, { kind: "system" });
    try {
      const result = await podProvider().submit({
        externalId: claimed.externalId,
        accountId: claimed.accountId,
        sku: claimed.sku,
        provider: claimed.provider,
        payload: claimed.payload,
      });
      await applySubmit.call(
        { jobId: claimed.jobId, leaseToken: claimed.leaseToken, externalRef: result.externalRef },
        { kind: "system" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The print provider could not take that job.";
      await applySubmit.call(
        { jobId: claimed.jobId, leaseToken: claimed.leaseToken, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listPodJobs.call({}, { kind: "system" })).find((row) => row.id === claimed.jobId);
    if (!found) throw new ServiceError("not_found", "No such print job.");
    return found;
  },
});

const claimRefresh = defineService({
  name: "printOnDemand.claimRefresh",
  summary: "Lease a submitted print job before reading its provider status.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: z.object({ jobId: z.string().uuid() }),
  output: z.object({ jobId: uuid, provider: z.string(), externalRef: z.string(), externalId: z.string(), accountId: z.string().nullable(), leaseToken: uuid }),
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1).for("update");
    if (!job || !["submitted", "fulfilled"].includes(job.status) || !job.externalRef) throw new ServiceError("conflict", "Submit that print job before checking its shipment.");
    if (job.providerLeaseToken && job.providerLeaseExpiresAt && job.providerLeaseExpiresAt > new Date()) {
      throw new ServiceError("conflict", "That print job is already being checked.");
    }
    const leaseToken = randomUUID();
    await ctx.tx.update(podJobs).set({ providerLeaseToken: leaseToken, providerLeaseExpiresAt: new Date(Date.now() + PROVIDER_LEASE_MS) }).where(eq(podJobs.id, job.id));
    return { jobId: job.id, provider: job.provider, externalRef: job.externalRef,
      accountId: job.providerAccountId,
      externalId: `freeholder:pod:${job.orderItemId ?? job.id}`, leaseToken };
  },
});

const applyRefresh = defineService({
  name: "printOnDemand.applyRefresh",
  summary: "Apply verified print-provider shipment evidence to its catalog fulfillment.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: z.object({ jobId: z.string().uuid(), leaseToken: z.string().uuid(),
    providerStatus: z.string().max(80).optional(), shipments: listed(shipmentRow).optional(),
    lastError: z.string().max(500).optional() }),
  output: jobRow,
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1).for("update");
    if (!job || job.providerLeaseToken !== input.leaseToken || !job.providerLeaseExpiresAt || job.providerLeaseExpiresAt <= new Date()) {
      throw new ServiceError("conflict", "That shipment check no longer owns its print job.");
    }
    const shipments = input.shipments ?? [];
    if (!input.lastError && input.providerStatus === "fulfilled" && job.fulfillmentId && shipments.length > 0) {
      let fulfillment = await catalogCall<CatalogFulfillment>(ctx, "catalog.getFulfillment", { id: job.fulfillmentId });
      if (["pending", "picking", "packed"].includes(fulfillment.fulfillment.status)) {
        const primary = shipments[0]!;
        fulfillment = await catalogCall<CatalogFulfillment>(ctx, "catalog.shipFulfillment", {
          id: job.fulfillmentId, carrier: primary.carrier, trackingNumber: primary.number,
          ...(primary.url ? { trackingUrl: primary.url } : {}),
        });
      }
      if (fulfillment.fulfillment.status === "shipped" && shipments.every((entry) => entry.deliveredAt && Number.isFinite(Date.parse(entry.deliveredAt)) && Date.parse(entry.deliveredAt) <= Date.now())) {
        await catalogCall(ctx, "catalog.deliverFulfillment", { id: job.fulfillmentId });
      }
    }
    const [updated] = await ctx.tx.update(podJobs).set({
      providerLeaseToken: null, providerLeaseExpiresAt: null, lastError: input.lastError ?? null,
      ...(!input.lastError && input.providerStatus === "fulfilled" && shipments.length > 0 ? { status: "fulfilled" } : {}),
      ...(!input.lastError ? { providerStatus: input.providerStatus ?? job.providerStatus, shipments } : {}),
    }).where(eq(podJobs.id, job.id)).returning();
    ctx.setSubject("pod_job", job.id);
    return updated!;
  },
});

export const refreshPodJob = defineOrchestratedService({
  name: "printOnDemand.refresh",
  summary: "Check the real provider order and apply its shipment evidence.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  input: z.object({ jobId: z.string().uuid() }), output: jobRow,
  handler: async (input) => {
    const claimed = await claimRefresh.call(input, { kind: "system" });
    try {
      const result = await podProvider().getOrder(claimed);
      return await applyRefresh.call({ jobId: claimed.jobId, leaseToken: claimed.leaseToken,
        providerStatus: result.status, shipments: result.shipments }, { kind: "system" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The print provider could not check that shipment.";
      return applyRefresh.call({ jobId: claimed.jobId, leaseToken: claimed.leaseToken, lastError: message.slice(0, 500) }, { kind: "system" });
    }
  },
});

export const podConfiguration = defineService({
  name: "printOnDemand.configuration", summary: "Show whether this instance has configured a Printify merchant account.",
  kind: "query", permission: "scoped", input: z.object({}),
  output: z.object({ configured: z.boolean(), shopId: z.string().nullable() }),
  handler: async () => {
    const settings = env();
    const configured = Boolean(settings.PRINTIFY_API_TOKEN && settings.PRINTIFY_SHOP_ID && /^[1-9][0-9]*$/.test(settings.PRINTIFY_SHOP_ID));
    return { configured, shopId: settings.PRINTIFY_SHOP_ID ?? null };
  },
});

export const podWorkBatch = defineService({
  name: "printOnDemand.workBatch", summary: "Select a bounded, oldest-first batch of eligible print jobs.",
  kind: "query", permission: "system", input: z.object({ kind: z.enum(["submit", "refresh"]) }), output: listed(jobRow),
  handler: (input, ctx) => ctx.tx.select().from(podJobs).where(and(
    inArray(podJobs.status, input.kind === "submit" ? ["queued", "failed", "submitting"] : ["submitted"]),
    or(isNull(podJobs.providerLeaseExpiresAt), lt(podJobs.providerLeaseExpiresAt, new Date())),
  )).orderBy(asc(podJobs.updatedAt), asc(podJobs.id)).limit(50),
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
  claimRefresh,
  applyRefresh,
  refreshPodJob,
  podConfiguration,
  podWorkBatch,
  listPodJobs,
];
