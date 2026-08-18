// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Contribution channel services (MASTER.md §4.8, C1.30, C1.32).
//
// Admin, HTTP and MCP all call these. Spoke submit never fetches; delivery is
// a job. Hub ingest is public and write-only, and is 404 until hub mode is on.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  defineService,
  redact,
  ServiceError,
  actorString,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import {
  registerContactReference,
  resolveContact,
} from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { assertDeliverableUrl, newSecret, verifySignature } from "@/core/webhooks/sign";
import {
  CONTRIBUTE_ASSET_ROLES,
  CONTRIBUTE_KINDS,
  CONTRIBUTE_SOURCES,
  CONTRIBUTE_STATUSES,
  contributionAssets,
  contributionEvents,
  contributions,
  contributeSettings,
} from "./schema";
import { db } from "@/core/db";
import {
  DEFAULT_HUB_URL,
  deliverQueuedContribution,
  deliverStatusReply,
  isCanonicalProjectHub,
  isSelfHub,
  recordStatusUrl,
  spokeBodyJson,
  type ContributeSettingsView,
} from "./deliver";

const kindSchema = z.enum(CONTRIBUTE_KINDS);
const statusSchema = z.enum(CONTRIBUTE_STATUSES);
const sourceSchema = z.enum(CONTRIBUTE_SOURCES);

const titleSchema = z.string().trim().min(1).max(200);
const bodySchema = z.string().trim().min(1).max(20_000);
const localeSchema = z.string().trim().min(2).max(16).default("en");
const emailSchema = z.string().trim().email().toLowerCase();

const contributionOutput = z.object({
  id: uuid,
  contactId: uuid.nullable(),
  kind: kindSchema,
  status: statusSchema,
  title: z.string(),
  body: z.string(),
  locale: z.string(),
  source: sourceSchema,
  reporterEmail: z.string().nullable(),
  reporterName: z.string().nullable(),
  externalUrl: z.string().nullable(),
  hubReceiptId: uuid.nullable(),
  contentHash: z.string(),
  includeDoctor: z.boolean(),
  doctorReport: z.unknown().nullable(),
  platformVersion: z.string().nullable(),
  dcoAttested: z.boolean(),
  dcoSigner: z.string().nullable(),
  checklistId: z.string().nullable(),
  parentId: uuid.nullable(),
  actor: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export type ContributionRecord = z.output<typeof contributionOutput>;

const settingsOutput = z.object({
  hubEnabled: z.boolean(),
  hubUrl: z.string(),
  hasReceiveSecret: z.boolean(),
  receiveSecret: z.string().optional(),
});

const contributionDetail = contributionOutput.extend({
  events: listed(
    row({
      id: uuid,
      kind: z.string(),
      body: z.string().nullable(),
      actor: z.string(),
      createdAt: timestamp,
    }),
  ),
  assets: listed(
    row({
      id: uuid,
      assetId: uuid,
      role: z.enum(CONTRIBUTE_ASSET_ROLES),
    }),
  ),
});

const attachOutput = z.union([
  row({
    id: uuid,
    contributionId: uuid,
    assetId: uuid,
    role: z.enum(CONTRIBUTE_ASSET_ROLES),
    createdAt: timestamp,
  }),
  z.object({
    id: uuid,
    attached: z.literal(false),
  }),
]);

registerContactReference({
  table: "contributions",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(contributions)
      .set({ contactId: survivingId })
      .where(eq(contributions.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: contributions.id, contactId: contributions.contactId })
      .from(contributions)
      .where(inArray(contributions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(
      z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
    );
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: contributions.id, contactId: contributions.contactId })
          .from(contributions)
          .where(inArray(contributions.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "A contribution changed after this merge. Restore that record first or leave the merge in place.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(contributions)
        .set({ contactId: duplicateId })
        .where(inArray(contributions.id, moved.map((row) => row.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "contribute.reports",
  tables: ["contributions"],
  exportData: (tx, contactId) =>
    tx
      .select({
        id: contributions.id,
        kind: contributions.kind,
        status: contributions.status,
        title: contributions.title,
        body: contributions.body,
        locale: contributions.locale,
        source: contributions.source,
        createdAt: contributions.createdAt,
      })
      .from(contributions)
      .where(eq(contributions.contactId, contactId)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(contributions)
      .set({
        body: "[erased]",
        reporterEmail: null,
        reporterName: null,
        doctorReport: null,
        externalUrl: null,
      })
      .where(eq(contributions.contactId, contactId))
      .returning({ id: contributions.id });
    return { affected: rows.length };
  },
});

function hashContent(input: {
  kind: string;
  title: string;
  body: string;
  email?: string | null;
  locale: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: input.kind,
        title: input.title.trim(),
        body: input.body.trim(),
        email: (input.email ?? "").trim().toLowerCase(),
        locale: input.locale,
      }),
    )
    .digest("hex");
}

function refuseSecurity(
  kind: string,
): asserts kind is (typeof CONTRIBUTE_KINDS)[number] {
  if (kind === "security") {
    throw new ServiceError(
      "validation",
      "Security reports are not accepted here. See SECURITY.md or email tony@paradisemodern.com with the subject [SECURITY] Freeholder.",
    );
  }
}

function requirePatchDco(input: {
  kind: string;
  dcoAttested: boolean;
  dcoSigner?: string;
}): void {
  if (input.kind !== "patch") return;
  if (!input.dcoAttested || !input.dcoSigner) {
    throw new ServiceError(
      "validation",
      "A code submission needs a Developer Certificate of Origin sign-off and the signer's name.",
    );
  }
}

function present(row: typeof contributions.$inferSelect): ContributionRecord {
  return contributionOutput.parse(row);
}

async function loadSettings(tx: Tx): Promise<ContributeSettingsView> {
  const [row] = await tx.select().from(contributeSettings).limit(1);
  if (!row) {
    return {
      hubEnabled: isCanonicalProjectHub(),
      hubUrl: DEFAULT_HUB_URL,
      hasReceiveSecret: false,
      receiveSecret: null,
    };
  }
  return {
    hubEnabled: row.hubEnabled,
    hubUrl: row.hubUrl,
    hasReceiveSecret: Boolean(row.receiveSecret),
    receiveSecret: row.receiveSecret,
  };
}

async function ensureSettings(tx: Tx) {
  const [existing] = await tx.select().from(contributeSettings).limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(contributeSettings)
    .values({ id: 1, hubEnabled: isCanonicalProjectHub() })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx.select().from(contributeSettings).limit(1);
  return again!;
}

async function recordEvent(
  tx: Tx,
  contributionId: string,
  kind: string,
  actor: string,
  body?: string,
) {
  await tx.insert(contributionEvents).values({
    contributionId,
    kind,
    actor,
    body: body ?? null,
  });
}

const composeInput = z.object({
  kind: z.union([kindSchema, z.literal("security")]),
  title: titleSchema,
  body: bodySchema,
  locale: localeSchema,
  email: emailSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  externalUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((value) => /^https:\/\/(www\.)?github\.com\//i.test(value), {
      message: "A code link has to be an https://github.com/ address.",
    })
    .optional(),
  includeDoctor: z.boolean().default(false),
  doctorReport: z.unknown().optional(),
  dcoAttested: z.boolean().default(false),
  dcoSigner: z.string().trim().min(1).max(200).optional(),
});

export const getContributeSettings = defineService({
  name: "contribute.getSettings",
  summary: "Read whether this instance receives or delivers contributions.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: settingsOutput,
  handler: async (_input, ctx) => {
    const settings = await loadSettings(ctx.tx);
    return settingsOutput.parse({
      hubEnabled: settings.hubEnabled,
      hubUrl: settings.hubUrl,
      hasReceiveSecret: settings.hasReceiveSecret,
    });
  },
});

export const contributeHubStatus = defineService({
  name: "contribute.hubStatus",
  summary: "Whether this instance is accepting public contributions.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: z.object({ hubEnabled: z.boolean() }),
  handler: async (_input, ctx) => {
    const settings = await loadSettings(ctx.tx);
    return { hubEnabled: settings.hubEnabled };
  },
});

export const setHubEnabled = defineService({
  name: "contribute.setHubEnabled",
  summary: "Turn hub ingest on or off. Required boolean — this is the switch.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    enabled: z.boolean(),
  }),
  output: settingsOutput,
  handler: async (input, ctx) => {
    await ensureSettings(ctx.tx);
    const [updated] = await ctx.tx
      .update(contributeSettings)
      .set({ hubEnabled: input.enabled })
      .where(eq(contributeSettings.id, 1))
      .returning();
    ctx.setSubject("contribute_settings", "1");
    ctx.queueEvent("contribute.hubToggled", { enabled: input.enabled });
    return settingsOutput.parse({
      hubEnabled: updated!.hubEnabled,
      hubUrl: updated!.hubUrl,
      hasReceiveSecret: Boolean(updated!.receiveSecret),
    });
  },
});

export const updateContributeSettings = defineService({
  name: "contribute.updateSettings",
  summary: "Change hub ingest and the destination this instance delivers to.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    hubEnabled: z.boolean().optional(),
    hubUrl: z.string().trim().max(500).optional(),
    rotateReceiveSecret: z.boolean().optional(),
    clearReceiveSecret: z.boolean().optional(),
  }),
  output: settingsOutput,
  handler: async (input, ctx) => {
    if (
      (input.rotateReceiveSecret || input.clearReceiveSecret) &&
      ctx.actor.kind === "agent"
    ) {
      throw new ServiceError(
        "permission",
        "An API key cannot rotate the contribution receive secret. Sign in as the owner.",
      );
    }
    const row = await ensureSettings(ctx.tx);
    let hubUrl = input.hubUrl ?? row.hubUrl;
    if (input.hubUrl !== undefined) {
      hubUrl = input.hubUrl.trim();
      if (hubUrl) {
        assertDeliverableUrl(hubUrl);
      }
    }
    let receiveSecret = row.receiveSecret;
    if (input.clearReceiveSecret) receiveSecret = null;
    if (input.rotateReceiveSecret) receiveSecret = newSecret();
    const [updated] = await ctx.tx
      .update(contributeSettings)
      .set({
        hubEnabled: input.hubEnabled ?? row.hubEnabled,
        hubUrl,
        receiveSecret,
      })
      .where(eq(contributeSettings.id, 1))
      .returning();
    ctx.setSubject("contribute_settings", "1");
    return settingsOutput.parse({
      hubEnabled: updated!.hubEnabled,
      hubUrl: updated!.hubUrl,
      hasReceiveSecret: Boolean(updated!.receiveSecret),
      receiveSecret: input.rotateReceiveSecret
        ? (updated!.receiveSecret ?? undefined)
        : undefined,
    });
  },
});

export const draftContribution = defineService({
  name: "contribute.draft",
  summary: "Save a contribution locally without sending it.",
  kind: "mutation",
  permission: "scoped",
  input: composeInput,
  rateLimit: {
    limit: 30,
    windowSeconds: 10 * 60,
    subject: () => "contribute:draft",
    message: "Wait a few minutes before drafting another report.",
  },
  output: contributionOutput,
  handler: async (input, ctx) => {
    refuseSecurity(input.kind);
    requirePatchDco(input);
    const hash = hashContent({
      kind: input.kind,
      title: input.title,
      body: input.body,
      email: input.email,
      locale: input.locale,
    });
    const doctorReport =
      input.includeDoctor && input.doctorReport !== undefined
        ? redact(input.doctorReport)
        : null;
    const [row] = await ctx.tx
      .insert(contributions)
      .values({
        kind: input.kind,
        status: "draft",
        title: input.title,
        body: input.body,
        locale: input.locale,
        source: ctx.actor.kind === "agent" ? "mcp" : "admin",
        reporterEmail: input.email ?? null,
        reporterName: input.name ?? null,
        externalUrl: input.externalUrl ?? null,
        contentHash: hash,
        includeDoctor: input.includeDoctor,
        doctorReport,
        platformVersion: process.env.npm_package_version ?? "0.0.0",
        dcoAttested: input.dcoAttested,
        dcoSigner: input.dcoSigner ?? null,
        actor: actorString(ctx.actor),
      })
      .returning();
    await recordEvent(ctx.tx, row!.id, "drafted", actorString(ctx.actor));
    ctx.setSubject("contribution", row!.id);
    return present(row!);
  },
});

export const submitContribution = defineService({
  name: "contribute.submit",
  summary: "File a bug, feature request or question. Nothing is sent until this is called.",
  kind: "mutation",
  permission: "scoped",
  input: composeInput.extend({
    id: z.string().uuid().optional(),
  }),
  rateLimit: {
    limit: 10,
    windowSeconds: 10 * 60,
    subject: (input) => `contribute:submit:${input.email ?? "session"}`,
    message: "Wait a few minutes before sending another report.",
  },
  output: contributionOutput,
  handler: async (input, ctx) => {
    refuseSecurity(input.kind);
    requirePatchDco(input);
    const settings = await loadSettings(ctx.tx);
    const hash = hashContent({
      kind: input.kind,
      title: input.title,
      body: input.body,
      email: input.email,
      locale: input.locale,
    });
    const doctorReport =
      input.includeDoctor && input.doctorReport !== undefined
        ? redact(input.doctorReport)
        : null;

    let contactId: string | null = null;
    if (input.email) {
      const resolved = await ctx.callAsSystem(resolveContact, {
        email: input.email,
        name: input.name,
        source: "contribute",
      });
      contactId = resolved.contact.id;
    }

    const local = isSelfHub(settings.hubUrl);
    const status: "received" | "queued" = local ? "received" : "queued";
    const source: "mcp" | "admin" = ctx.actor.kind === "agent" ? "mcp" : "admin";
    const values = {
      contactId,
      kind: input.kind,
      status,
      title: input.title,
      body: input.body,
      locale: input.locale,
      source,
      reporterEmail: input.email ?? null,
      reporterName: input.name ?? null,
      externalUrl: input.externalUrl ?? null,
      contentHash: hash,
      includeDoctor: input.includeDoctor,
      doctorReport,
      platformVersion: process.env.npm_package_version ?? "0.0.0",
      dcoAttested: input.dcoAttested,
      dcoSigner: input.dcoSigner ?? null,
      actor: actorString(ctx.actor),
      replyUrl: local ? null : recordStatusUrl(),
      replyToken: local ? null : newSecret(),
      spokeId: null,
    };

    let row: typeof contributions.$inferSelect;
    if (input.id) {
      const [existing] = await ctx.tx
        .select()
        .from(contributions)
        .where(eq(contributions.id, input.id))
        .limit(1);
      if (!existing || existing.status !== "draft") {
        throw new ServiceError("not_found", "That draft is not available to send.");
      }
      const [updated] = await ctx.tx
        .update(contributions)
        .set(values)
        .where(eq(contributions.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [created] = await ctx.tx.insert(contributions).values(values).returning();
      row = created!;
    }

    await recordEvent(
      ctx.tx,
      row.id,
      local ? "received" : "queued",
      actorString(ctx.actor),
    );
    if (contactId) {
      await ctx.emitTimeline({
        contactId,
        eventType: "contribute.submitted",
        subjectType: "contribution",
        subjectId: row.id,
        payload: { kind: row.kind, title: row.title },
      });
    }
    ctx.setSubject("contribution", row.id);
    ctx.queueEvent("contribute.submitted", {
      id: row.id,
      kind: row.kind,
      status: row.status,
    });
    if (!local) {
      await ctx.queueJob(
        "contribute.deliver",
        { contributionId: row.id },
        { idempotencyKey: `contribute.deliver:${row.id}` },
      );
    } else {
      ctx.queueEvent("contribute.ingested", {
        id: row.id,
        kind: row.kind,
        title: row.title,
      });
    }
    return present(row);
  },
});

export const listContributions = defineService({
  name: "contribute.list",
  summary: "List contributions this instance holds.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: statusSchema.optional(),
    kind: kindSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  output: listed(contributionOutput),
  handler: async (input, ctx) => {
    const filters = [
      input.status ? eq(contributions.status, input.status) : undefined,
      input.kind ? eq(contributions.kind, input.kind) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    const rows = await ctx.tx
      .select()
      .from(contributions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(contributions.createdAt))
      .limit(input.limit);
    return rows.map(present);
  },
});

export const getContribution = defineService({
  name: "contribute.get",
  summary: "Read one contribution and its event trail.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: contributionDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contributions)
      .where(eq(contributions.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "That report was not found.");
    const events = await ctx.tx
      .select()
      .from(contributionEvents)
      .where(eq(contributionEvents.contributionId, row.id))
      .orderBy(contributionEvents.createdAt);
    const assets = await ctx.tx
      .select()
      .from(contributionAssets)
      .where(eq(contributionAssets.contributionId, row.id));
    return {
      ...present(row),
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        body: event.body,
        actor: event.actor,
        createdAt: event.createdAt,
      })),
      assets: assets.map((asset) => ({
        id: asset.id,
        assetId: asset.assetId,
        role: asset.role,
      })),
    };
  },
});

export const attachContributionAsset = defineService({
  name: "contribute.attach",
  summary: "Attach an existing media asset to a contribution.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    role: z.enum(CONTRIBUTE_ASSET_ROLES).default("other"),
  }),
  output: attachOutput,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select({ id: contributions.id })
      .from(contributions)
      .where(eq(contributions.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "That report was not found.");
    const [attached] = await ctx.tx
      .insert(contributionAssets)
      .values({
        contributionId: row.id,
        assetId: input.assetId,
        role: input.role,
      })
      .onConflictDoNothing()
      .returning();
    ctx.setSubject("contribution", row.id);
    return attached ?? { id: row.id, attached: false };
  },
});

export const ingestContribution = defineService({
  name: "contribute.ingest",
  summary: "Receive a contribution on a hub instance. 404 unless hub ingest is on.",
  kind: "mutation",
  permission: "public",
  input: composeInput.extend({
    source: z.enum(["public_form", "spoke", "http", "mcp"]).default("http"),
    contentHash: z.string().trim().min(32).max(128).optional(),
    signature: z.string().trim().min(1).max(500).optional(),
    platformVersion: z.string().trim().max(40).optional(),
    spokeId: z.string().uuid().optional(),
    replyUrl: z.string().trim().url().max(500).optional(),
    replyToken: z.string().trim().min(8).max(200).optional(),
  }),
  rateLimit: {
    limit: 20,
    windowSeconds: 10 * 60,
    subject: (input) => `contribute:ingest:${input.email ?? "anon"}`,
    message: "This inbox is taking a short break. Try again in a few minutes.",
  },
  output: contributionOutput,
  handler: async (input, ctx) => {
    refuseSecurity(input.kind);
    requirePatchDco(input);
    const settings = await loadSettings(ctx.tx);
    if (!settings.hubEnabled) {
      throw new ServiceError("not_found", "This instance is not accepting contributions.");
    }
    if (input.signature) {
      if (!settings.receiveSecret) {
        throw new ServiceError("permission", "This hub is not accepting signed deliveries.");
      }
      const hash =
        input.contentHash ??
        hashContent({
          kind: input.kind,
          title: input.title,
          body: input.body,
          email: input.email,
          locale: input.locale,
        });
      const signed = spokeBodyJson({
        kind: input.kind,
        title: input.title,
        body: input.body,
        locale: input.locale,
        reporterEmail: input.email ?? null,
        reporterName: input.name ?? null,
        includeDoctor: input.includeDoctor,
        doctorReport: input.includeDoctor ? input.doctorReport : null,
        platformVersion: input.platformVersion ?? null,
        dcoAttested: input.dcoAttested,
        dcoSigner: input.dcoSigner ?? null,
        externalUrl: input.externalUrl ?? null,
        contentHash: hash,
        id: input.spokeId,
        replyUrl: input.replyUrl ?? null,
        replyToken: input.replyToken ?? null,
      });
      if (!verifySignature(settings.receiveSecret, signed, input.signature)) {
        throw new ServiceError("permission", "That signature is not valid.");
      }
    }

    const hash =
      input.contentHash ??
      hashContent({
        kind: input.kind,
        title: input.title,
        body: input.body,
        email: input.email,
        locale: input.locale,
      });
    const [existing] = await ctx.tx
      .select()
      .from(contributions)
      .where(eq(contributions.contentHash, hash))
      .limit(1);
    if (existing) {
      ctx.setSubject("contribution", existing.id);
      return present(existing);
    }

    let contactId: string | null = null;
    if (input.email) {
      const resolved = await ctx.callAsSystem(resolveContact, {
        email: input.email,
        name: input.name,
        source: "contribute",
      });
      contactId = resolved.contact.id;
    }

    const doctorReport =
      input.includeDoctor && input.doctorReport !== undefined
        ? redact(input.doctorReport)
        : null;
    if (input.replyUrl) {
      assertDeliverableUrl(input.replyUrl);
    }
    const [row] = await ctx.tx
      .insert(contributions)
      .values({
        contactId,
        kind: input.kind,
        status: "received",
        title: input.title,
        body: input.body,
        locale: input.locale,
        source: input.source === "spoke" ? "spoke" : input.source,
        reporterEmail: input.email ?? null,
        reporterName: input.name ?? null,
        externalUrl: input.externalUrl ?? null,
        contentHash: hash,
        includeDoctor: input.includeDoctor,
        doctorReport,
        platformVersion: input.platformVersion ?? null,
        dcoAttested: input.dcoAttested,
        dcoSigner: input.dcoSigner ?? null,
        actor: actorString(ctx.actor),
        spokeId: input.spokeId ?? null,
        replyUrl: input.replyUrl ?? null,
        replyToken: input.replyToken ?? null,
      })
      .returning();
    await recordEvent(ctx.tx, row!.id, "ingested", actorString(ctx.actor));
    if (contactId) {
      await ctx.emitTimeline({
        contactId,
        eventType: "contribute.ingested",
        subjectType: "contribution",
        subjectId: row!.id,
        payload: { kind: row!.kind, title: row!.title },
      });
    }
    ctx.setSubject("contribution", row!.id);
    ctx.queueEvent("contribute.ingested", {
      id: row!.id,
      kind: row!.kind,
      title: row!.title,
    });
    return present(row!);
  },
});

const determinationSchema = z.enum([
  "triage",
  "needs_info",
  "accepted",
  "duplicate",
  "wontfix",
  "shipped",
]);

export const triageContribution = defineService({
  name: "contribute.triage",
  summary: "Move a received contribution into triage.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    note: z.string().trim().max(4000).optional(),
  }),
  output: contributionOutput,
  handler: async (input, ctx) =>
    moveStatus(ctx, input.id, "triage", input.note),
});

export const determineContribution = defineService({
  name: "contribute.determine",
  summary: "Record a determination. This never edits MASTER.md.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    status: determinationSchema,
    note: z.string().trim().max(4000).optional(),
    checklistId: z
      .string()
      .trim()
      .regex(/^C\d{1,2}\.\d{2}$/, "Cite a checklist id such as C2.12.")
      .optional(),
    parentId: z.string().uuid().optional(),
  }),
  output: contributionOutput,
  handler: async (input, ctx) => {
    if (input.status === "accepted" && !input.checklistId) {
      // A citation is allowed, not required: the work may not be scoped yet.
    }
    if (input.status === "duplicate" && !input.parentId) {
      throw new ServiceError(
        "validation",
        "Marking a duplicate needs the id of the surviving report.",
      );
    }
    return moveStatus(ctx, input.id, input.status, input.note, {
      checklistId: input.checklistId,
      parentId: input.parentId,
    });
  },
});

async function moveStatus(
  ctx: ServiceContext,
  id: string,
  status: z.infer<typeof statusSchema>,
  note?: string,
  extra: { checklistId?: string; parentId?: string } = {},
) {
  const settings = await loadSettings(ctx.tx);
  if (!settings.hubEnabled) {
    throw new ServiceError("not_found", "This instance is not accepting contributions.");
  }
  const [existing] = await ctx.tx
    .select()
    .from(contributions)
    .where(eq(contributions.id, id))
    .limit(1);
  if (!existing) throw new ServiceError("not_found", "That report was not found.");
  const [row] = await ctx.tx
    .update(contributions)
    .set({
      status,
      checklistId: extra.checklistId ?? existing.checklistId,
      parentId: extra.parentId ?? existing.parentId,
    })
    .where(eq(contributions.id, id))
    .returning();
  await recordEvent(ctx.tx, row!.id, status, actorString(ctx.actor), note);
  ctx.setSubject("contribution", row!.id);
  ctx.queueEvent("contribute.determined", {
    id: row!.id,
    status,
    checklistId: row!.checklistId,
  });
  if (row!.replyUrl && row!.spokeId && row!.replyToken) {
    await ctx.queueJob(
      "contribute.reply",
      { contributionId: row!.id, note: note ?? null },
      { idempotencyKey: `contribute.reply:${row!.id}:${status}` },
    );
  }
  return present(row!);
}

const replyStatusSchema = z.enum([
  "received",
  "triage",
  "needs_info",
  "accepted",
  "duplicate",
  "wontfix",
  "shipped",
]);

function tokensMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const recordContributionStatus = defineService({
  name: "contribute.recordStatus",
  summary: "Record a hub determination on the instance that filed the report.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    spokeId: z.string().uuid(),
    replyToken: z.string().trim().min(8).max(200),
    status: replyStatusSchema,
    note: z.string().trim().max(4000).optional(),
    checklistId: z
      .string()
      .trim()
      .regex(/^C\d{1,2}\.\d{2}$/)
      .optional(),
    hubId: z.string().uuid().optional(),
  }),
  rateLimit: {
    limit: 30,
    windowSeconds: 10 * 60,
    subject: (input) => `contribute:reply:${input.spokeId}`,
    message: "Wait a moment before sending another status update.",
  },
  output: contributionOutput,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(contributions)
      .where(eq(contributions.id, input.spokeId))
      .limit(1);
    if (!existing || !existing.replyToken) {
      throw new ServiceError("not_found", "That report was not found.");
    }
    if (!tokensMatch(existing.replyToken, input.replyToken)) {
      throw new ServiceError("permission", "That reply token is not valid.");
    }
    const [row] = await ctx.tx
      .update(contributions)
      .set({
        status: input.status,
        checklistId: input.checklistId ?? existing.checklistId,
        hubReceiptId: input.hubId ?? existing.hubReceiptId,
      })
      .where(eq(contributions.id, existing.id))
      .returning();
    await recordEvent(
      ctx.tx,
      row!.id,
      input.status,
      actorString(ctx.actor),
      input.note,
    );
    ctx.setSubject("contribution", row!.id);
    ctx.queueEvent("contribute.statusUpdated", {
      id: row!.id,
      status: input.status,
      title: row!.title,
    });
    return present(row!);
  },
});

export async function runContributeDeliverJob(data: Record<string, unknown>) {
  const contributionId = z.string().uuid().parse(data.contributionId);
  const [row] = await db().select().from(contributeSettings).limit(1);
  return deliverQueuedContribution(contributionId, {
    hubUrl: row?.hubUrl ?? DEFAULT_HUB_URL,
    hubSecret: row?.receiveSecret ?? null,
  });
}

export async function runContributeReplyJob(
  data: Record<string, unknown>,
  options: { fetchImpl?: typeof fetch } = {},
) {
  const contributionId = z.string().uuid().parse(data.contributionId);
  const note =
    typeof data.note === "string" && data.note.trim() ? data.note : undefined;
  const [row] = await db()
    .select()
    .from(contributions)
    .where(eq(contributions.id, contributionId))
    .limit(1);
  if (!row) return { sent: false };
  return deliverStatusReply(row, note, options);
}

export default [
  getContributeSettings,
  contributeHubStatus,
  setHubEnabled,
  updateContributeSettings,
  draftContribution,
  submitContribution,
  listContributions,
  getContribution,
  attachContributionAsset,
  ingestContribution,
  triageContribution,
  determineContribution,
  recordContributionStatus,
];
