// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Newsletters, double-opt-in, RFC 8058 unsubscribe, public archive (C9.04).

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isUniqueViolation } from "@/core/db";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { sendMail } from "@/core/mail/service";
import { siteOrigin } from "@/core/seo/origin";
import {
  newsletterIssues,
  newsletterSubscriptions,
  newsletters,
} from "./schema";
import { syncNewsletterIssuePage } from "./public-pages";
import "./blocks";

const id = z.string().uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(180);
const expectedVersion = z.number().int().positive();

const newsletterRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.enum(["active", "paused"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const newsletterIssueRow = row({
  id: uuid,
  newsletterId: uuid,
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  body: z.string(),
  status: z.enum(["draft", "published"]),
  seo: z.unknown(),
  workingTitle: z.string().nullable(),
  workingExcerpt: z.string().nullable(),
  workingBody: z.string().nullable(),
  workingSeo: z.unknown().nullable(),
  version: z.number().int(),
  publishedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const newsletterSubscriptionRow = row({
  id: uuid,
  newsletterId: uuid,
  contactId: uuid,
  status: z.enum(["pending", "confirmed", "unsubscribed"]),
  confirmToken: z.string(),
  unsubscribeToken: z.string(),
  confirmedAt: timestamp.nullable(),
  unsubscribedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

function token(): string {
  return randomBytes(32).toString("hex");
}

const RANK = { confirmed: 3, pending: 2, unsubscribed: 1 } as const;

registerContactReference({
  table: "newsletter_subscriptions",
  repoint: async (tx, duplicateId, survivingId) => {
    const incoming = await tx
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, duplicateId));
    for (const row of incoming) {
      const [already] = await tx
        .select()
        .from(newsletterSubscriptions)
        .where(
          and(
            eq(newsletterSubscriptions.newsletterId, row.newsletterId),
            eq(newsletterSubscriptions.contactId, survivingId),
          ),
        )
        .limit(1);
      if (!already) {
        await tx
          .update(newsletterSubscriptions)
          .set({ contactId: survivingId })
          .where(eq(newsletterSubscriptions.id, row.id));
        continue;
      }
      const keepSurvivor = RANK[already.status] >= RANK[row.status];
      if (keepSurvivor) {
        await tx.delete(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, row.id));
      } else {
        await tx.delete(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, already.id));
        await tx
          .update(newsletterSubscriptions)
          .set({ contactId: survivingId })
          .where(eq(newsletterSubscriptions.id, row.id));
      }
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const rows = await tx
      .select({ id: newsletterSubscriptions.id })
      .from(newsletterSubscriptions)
      .where(inArray(newsletterSubscriptions.contactId, [duplicateId, survivingId]));
    return {
      state: rows,
      undoable: rows.length === 0,
      blocker:
        rows.length > 0
          ? "Newsletter subscriptions were merged and cannot be split back apart safely."
          : undefined,
    };
  },
  restoreAfterUndo: async () => undefined,
});

registerContactPrivacySource({
  scope: "newsletters.subscriptions",
  tables: ["newsletter_subscriptions"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({
        id: newsletterSubscriptions.id,
        newsletterId: newsletterSubscriptions.newsletterId,
        status: newsletterSubscriptions.status,
        confirmedAt: newsletterSubscriptions.confirmedAt,
        unsubscribedAt: newsletterSubscriptions.unsubscribedAt,
      })
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .update(newsletterSubscriptions)
      .set({
        status: "unsubscribed",
        unsubscribedAt: sql`now()`,
        confirmToken: token(),
        unsubscribeToken: token(),
      })
      .where(eq(newsletterSubscriptions.contactId, contactId))
      .returning({ id: newsletterSubscriptions.id });
    return { affected: rows.length };
  },
});

export const listNewsletters = defineService({
  name: "newsletters.list",
  summary: "List newsletter identities for the owner workspace.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(newsletterRow),
  handler: async (_input, ctx) =>
    ctx.tx.select().from(newsletters).orderBy(desc(newsletters.updatedAt)),
});

export const listPublicNewsletters = defineService({
  name: "newsletters.listPublic",
  summary: "Active newsletters a visitor may subscribe to.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: listed(newsletterRow),
  handler: async (_input, ctx) =>
    ctx.tx.select().from(newsletters).where(eq(newsletters.status, "active")).orderBy(asc(newsletters.name)),
});

export const getNewsletter = defineService({
  name: "newsletters.get",
  summary: "One newsletter with issues and subscription counts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: z.object({
    newsletter: newsletterRow,
    issues: listed(newsletterIssueRow),
    subscriptions: listed(newsletterSubscriptionRow),
  }),
  handler: async (input, ctx) => {
    const [newsletter] = await ctx.tx.select().from(newsletters).where(eq(newsletters.id, input.id)).limit(1);
    if (!newsletter) throw new ServiceError("not_found", "That newsletter is not here.");
    const issues = await ctx.tx
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.newsletterId, newsletter.id))
      .orderBy(desc(newsletterIssues.updatedAt));
    const subscriptions = await ctx.tx
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.newsletterId, newsletter.id))
      .orderBy(desc(newsletterSubscriptions.updatedAt));
    return { newsletter, issues, subscriptions };
  },
});

export const createNewsletter = defineService({
  name: "newsletters.create",
  summary: "Create a newsletter identity.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    slug,
    description: z.string().trim().max(2_000).optional(),
  }),
  output: newsletterRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx
      .insert(newsletters)
      .values({
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "newsletters_slug_idx")) {
          throw new ServiceError("conflict", `Another newsletter already uses ${input.slug}.`);
        }
        throw error;
      });
    ctx.setSubject("newsletter", created!.id);
    ctx.queueEvent("newsletters.created", { newsletterId: created!.id });
    return created!;
  },
});

export const updateNewsletter = defineService({
  name: "newsletters.update",
  summary: "Update a newsletter identity or pause it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    status: z.enum(["active", "paused"]).optional(),
  }),
  output: newsletterRow,
  handler: async (input, ctx) => {
    const { id: newsletterId, ...patch } = input;
    const [updated] = await ctx.tx
      .update(newsletters)
      .set(patch)
      .where(eq(newsletters.id, newsletterId))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That newsletter is not here.");
    ctx.setSubject("newsletter", updated.id);
    ctx.queueEvent("newsletters.updated", { newsletterId: updated.id });
    return updated;
  },
});

export const listPublicIssues = defineService({
  name: "newsletters.listPublicIssues",
  summary: "Published issues for the public archive.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: listed(newsletterIssueRow),
  handler: async (_input, ctx) =>
    ctx.tx
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.status, "published"))
      .orderBy(desc(newsletterIssues.publishedAt)),
});

export const resolvePublicIssue = defineService({
  name: "newsletters.resolvePublicIssue",
  summary: "A published issue by slug.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: newsletterIssueRow.nullable(),
  handler: async (input, ctx) => {
    const [issue] = await ctx.tx
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.slug, input.slug))
      .limit(1);
    if (!issue || issue.status !== "published") return null;
    return issue;
  },
});

export const createIssue = defineService({
  name: "newsletters.createIssue",
  summary: "Draft an issue for a newsletter.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    newsletterId: id,
    slug,
    title: z.string().trim().min(1).max(240),
    excerpt: z.string().trim().max(500).optional(),
    body: z.string().max(100_000).default(""),
  }),
  output: newsletterIssueRow,
  handler: async (input, ctx) => {
    const [newsletter] = await ctx.tx
      .select({ id: newsletters.id })
      .from(newsletters)
      .where(eq(newsletters.id, input.newsletterId))
      .limit(1);
    if (!newsletter) throw new ServiceError("not_found", "That newsletter is not here.");
    const [created] = await ctx.tx
      .insert(newsletterIssues)
      .values({
        newsletterId: input.newsletterId,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt ?? null,
        body: input.body,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "newsletter_issues_slug_idx")) {
          throw new ServiceError("conflict", `Another issue already uses /newsletters/${input.slug}.`);
        }
        throw error;
      });
    ctx.setSubject("newsletterIssue", created!.id);
    ctx.queueEvent("newsletters.issueCreated", { issueId: created!.id });
    return created!;
  },
});

export const updateIssue = defineService({
  name: "newsletters.updateIssue",
  summary: "Edit an issue. A published issue's live copy does not change until publish.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    expectedVersion,
    title: z.string().trim().min(1).max(240).optional(),
    excerpt: z.string().trim().max(500).nullable().optional(),
    body: z.string().max(100_000).optional(),
    seo: z.object({ title: z.string().max(60).optional(), description: z.string().max(155).optional() }).optional(),
  }),
  output: newsletterIssueRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That issue is not here.");
    if (existing.version !== input.expectedVersion) {
      throw new ServiceError("conflict", "This issue changed after you opened it.");
    }
    const published = existing.status === "published";
    const [updated] = await ctx.tx
      .update(newsletterIssues)
      .set({
        ...(published
          ? {
              workingTitle: input.title ?? existing.workingTitle ?? existing.title,
              workingExcerpt:
                input.excerpt !== undefined
                  ? input.excerpt
                  : (existing.workingExcerpt ?? existing.excerpt),
              workingBody: input.body ?? existing.workingBody ?? existing.body,
              workingSeo: input.seo ?? existing.workingSeo ?? existing.seo,
            }
          : {
              ...(input.title !== undefined ? { title: input.title, workingTitle: input.title } : {}),
              ...(input.excerpt !== undefined
                ? { excerpt: input.excerpt, workingExcerpt: input.excerpt }
                : {}),
              ...(input.body !== undefined ? { body: input.body, workingBody: input.body } : {}),
              ...(input.seo !== undefined ? { seo: input.seo, workingSeo: input.seo } : {}),
            }),
        version: existing.version + 1,
      })
      .where(and(eq(newsletterIssues.id, existing.id), eq(newsletterIssues.version, existing.version)))
      .returning();
    if (!updated) throw new ServiceError("conflict", "This issue changed while it was being saved.");
    ctx.setSubject("newsletterIssue", updated.id);
    ctx.queueEvent("newsletters.issueUpdated", { issueId: updated.id });
    return updated;
  },
});

export const publishIssue = defineService({
  name: "newsletters.publishIssue",
  summary: "Publish an issue to the public archive.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, expectedVersion }),
  output: newsletterIssueRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(newsletterIssues)
      .where(eq(newsletterIssues.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That issue is not here.");
    if (existing.version !== input.expectedVersion) {
      throw new ServiceError("conflict", "This issue changed after you opened it.");
    }
    const title = existing.workingTitle ?? existing.title;
    const excerpt = existing.workingExcerpt ?? existing.excerpt;
    const body = existing.workingBody ?? existing.body;
    const seo = existing.workingSeo ?? existing.seo;
    const [updated] = await ctx.tx
      .update(newsletterIssues)
      .set({
        status: "published",
        publishedAt: existing.publishedAt ?? sql`now()`,
        title,
        excerpt,
        body,
        seo,
        workingTitle: title,
        workingExcerpt: excerpt,
        workingBody: body,
        workingSeo: seo,
        version: existing.version + 1,
      })
      .where(and(eq(newsletterIssues.id, existing.id), eq(newsletterIssues.version, existing.version)))
      .returning();
    if (!updated) throw new ServiceError("conflict", "This issue changed during publish.");
    ctx.setSubject("newsletterIssue", updated.id);
    ctx.queueEvent("newsletters.issuePublished", { issueId: updated.id });
    await syncNewsletterIssuePage(ctx, updated.id);
    return updated;
  },
});

export const subscribeToNewsletter = defineService({
  name: "newsletters.subscribe",
  summary: "Start a double-opt-in subscription through contacts.resolve.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    newsletterId: id,
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.object({
    status: z.enum(["confirmed", "pending"]),
    subscriptionId: uuid,
  }),
  handler: async (input, ctx) => {
    const [newsletter] = await ctx.tx
      .select()
      .from(newsletters)
      .where(eq(newsletters.id, input.newsletterId))
      .limit(1);
    if (!newsletter || newsletter.status !== "active") {
      throw new ServiceError("not_found", "That newsletter is not open for subscriptions.");
    }
    const resolved = await ctx.callAsSystem(resolveContact, {
      email: input.email,
      name: input.name,
      source: "newsletter",
    });
    const [existing] = await ctx.tx
      .select()
      .from(newsletterSubscriptions)
      .where(
        and(
          eq(newsletterSubscriptions.newsletterId, newsletter.id),
          eq(newsletterSubscriptions.contactId, resolved.contact.id),
        ),
      )
      .limit(1);
    if (existing?.status === "confirmed") {
      return { status: "confirmed" as const, subscriptionId: existing.id };
    }
    const confirmToken = token();
    const unsubscribeToken = existing?.unsubscribeToken ?? token();
    const [saved] = existing
      ? await ctx.tx
          .update(newsletterSubscriptions)
          .set({
            status: "pending",
            confirmToken,
            unsubscribeToken,
            unsubscribedAt: null,
          })
          .where(eq(newsletterSubscriptions.id, existing.id))
          .returning()
      : await ctx.tx
          .insert(newsletterSubscriptions)
          .values({
            newsletterId: newsletter.id,
            contactId: resolved.contact.id,
            status: "pending",
            confirmToken,
            unsubscribeToken,
          })
          .returning();
    const origin = siteOrigin();
    const confirmUrl = `${origin}/newsletters/confirm?token=${confirmToken}`;
    try {
      await sendMail(ctx.tx, {
        to: input.email,
        subject: `Confirm ${newsletter.name}`,
        text: `Confirm your subscription to ${newsletter.name}: ${confirmUrl}`,
      });
    } catch {
      // Double-opt-in still exists; a missing sender must not invent a confirmed subscriber.
    }
    ctx.setSubject("newsletterSubscription", saved!.id);
    ctx.queueEvent("newsletters.subscribed", {
      subscriptionId: saved!.id,
      newsletterId: newsletter.id,
      contactId: resolved.contact.id,
    });
    return { status: "pending" as const, subscriptionId: saved!.id };
  },
});

export const confirmSubscription = defineService({
  name: "newsletters.confirm",
  summary: "Confirm a pending double-opt-in subscription.",
  kind: "mutation",
  permission: "public",
  input: z.object({ token: z.string().trim().min(16).max(128) }),
  output: newsletterSubscriptionRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.confirmToken, input.token))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "That confirmation link is not valid.");
    if (row.status === "unsubscribed") {
      throw new ServiceError("conflict", "This address has been unsubscribed.");
    }
    const [updated] = await ctx.tx
      .update(newsletterSubscriptions)
      .set({
        status: "confirmed",
        confirmedAt: row.confirmedAt ?? sql`now()`,
        confirmToken: token(),
      })
      .where(eq(newsletterSubscriptions.id, row.id))
      .returning();
    ctx.setSubject("newsletterSubscription", row.id);
    ctx.queueEvent("newsletters.confirmed", {
      subscriptionId: row.id,
      newsletterId: row.newsletterId,
      contactId: row.contactId,
    });
    return updated!;
  },
});

export const unsubscribeFromNewsletter = defineService({
  name: "newsletters.unsubscribe",
  summary: "RFC 8058 one-click unsubscribe by token.",
  kind: "mutation",
  permission: "public",
  input: z.object({ token: z.string().trim().min(16).max(128) }),
  output: newsletterSubscriptionRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.unsubscribeToken, input.token))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "That unsubscribe link is not valid.");
    const [updated] = await ctx.tx
      .update(newsletterSubscriptions)
      .set({
        status: "unsubscribed",
        unsubscribedAt: row.unsubscribedAt ?? sql`now()`,
        unsubscribeToken: token(),
      })
      .where(eq(newsletterSubscriptions.id, row.id))
      .returning();
    ctx.setSubject("newsletterSubscription", row.id);
    ctx.queueEvent("newsletters.unsubscribed", {
      subscriptionId: row.id,
      newsletterId: row.newsletterId,
      contactId: row.contactId,
    });
    return updated!;
  },
});

export function rfc8058UnsubscribeHeaders(origin: string, unsubscribeToken: string) {
  const url = `${origin}/unsubscribe?token=${unsubscribeToken}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Templates (C9.05). Re-exported because the manifest names one services
// module, and separate because authoring a template and sending an issue are
// not the same subject.
export {
  saveTemplate,
  resetTemplate,
  listTemplates,
  getTemplate,
  renderTemplate,
  templateSlots,
} from "./template-service";
import templateServices from "./template-service";

export default [
  listNewsletters,
  listPublicNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletter,
  listPublicIssues,
  resolvePublicIssue,
  createIssue,
  updateIssue,
  publishIssue,
  subscribeToNewsletter,
  confirmSubscription,
  unsubscribeFromNewsletter,
  ...templateServices,
];

