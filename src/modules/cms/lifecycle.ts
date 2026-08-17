// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Preview links, schedule, approval, named revisions and leases (C2.02, C2.03).
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError } from "@/core/service";
import { contentPreviewLinks, contentRevisions, pages } from "./schema";

const pageId = z.string().uuid();
const revisionId = z.string().uuid();
const optionalWhen = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.date().nullable().optional(),
);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

function flattenBlocks(
  nodes: unknown,
): Map<string, { id: string; type: string; props: unknown; children?: unknown }> {
  const out = new Map<
    string,
    { id: string; type: string; props: unknown; children?: unknown }
  >();
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const node of value) {
      if (!node || typeof node !== "object") continue;
      const record = node as {
        id?: unknown;
        type?: unknown;
        props?: unknown;
        children?: unknown;
      };
      if (typeof record.id !== "string" || typeof record.type !== "string") continue;
      out.set(record.id, {
        id: record.id,
        type: record.type,
        props: record.props,
        children: record.children,
      });
      walk(record.children);
    }
  };
  walk(nodes);
  return out;
}

export const createPreviewLink = defineService({
  name: "cms.createPreviewLink",
  summary: "Mint an expiring link that shows a page's working draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId,
    expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, input.pageId))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.pageId}`);

    const token = mintToken();
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
    const [link] = await ctx.tx
      .insert(contentPreviewLinks)
      .values({
        pageId: page.id,
        tokenHash: hashToken(token),
        expiresAt,
        createdBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("page", page.id);
    ctx.queueEvent("cms.previewLinkCreated", { pageId: page.id, linkId: link!.id });
    return {
      id: link!.id,
      token,
      path: `/preview/share/${token}`,
      expiresAt: link!.expiresAt,
    };
  },
});

export const listPreviewLinks = defineService({
  name: "cms.listPreviewLinks",
  summary: "Active and expired preview links for a page.",
  kind: "query",
  permission: "scoped",
  input: z.object({ pageId }),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: contentPreviewLinks.id,
        expiresAt: contentPreviewLinks.expiresAt,
        createdBy: contentPreviewLinks.createdBy,
        revokedAt: contentPreviewLinks.revokedAt,
        createdAt: contentPreviewLinks.createdAt,
      })
      .from(contentPreviewLinks)
      .where(eq(contentPreviewLinks.pageId, input.pageId))
      .orderBy(desc(contentPreviewLinks.createdAt)),
});

export const revokePreviewLink = defineService({
  name: "cms.revokePreviewLink",
  summary: "Stop a preview link from resolving.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [link] = await ctx.tx
      .update(contentPreviewLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(contentPreviewLinks.id, input.id), isNull(contentPreviewLinks.revokedAt)),
      )
      .returning();
    if (!link) throw new ServiceError("not_found", "that preview link is gone");
    ctx.setSubject("page", link.pageId);
    return { id: link.id, revokedAt: link.revokedAt };
  },
});

/**
 * Public: the token *is* the credential. Expired or revoked links resolve to
 * null so a shared URL never 500s or leaks that the page still exists after
 * the owner pulled it.
 */
export const resolvePreviewLink = defineService({
  name: "cms.resolvePreviewLink",
  summary: "The working draft behind a preview token, or null.",
  kind: "query",
  permission: "public",
  input: z.object({ token: z.string().min(16).max(128) }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select({
        link: contentPreviewLinks,
        page: pages,
      })
      .from(contentPreviewLinks)
      .innerJoin(pages, eq(pages.id, contentPreviewLinks.pageId))
      .where(eq(contentPreviewLinks.tokenHash, hashToken(input.token)))
      .limit(1);
    if (!row) return null;
    if (row.link.revokedAt) return null;
    if (row.link.expiresAt.getTime() <= Date.now()) return null;
    return {
      id: row.page.id,
      slug: row.page.slug,
      locale: row.page.locale,
      title: row.page.workingTitle ?? row.page.title,
      blocks: row.page.workingBlocks ?? row.page.blocks,
      seo: row.page.workingSeo ?? row.page.seo,
      expiresAt: row.link.expiresAt,
    };
  },
});

export const schedulePage = defineService({
  name: "cms.schedulePage",
  summary: "Set or clear a page's scheduled publish and unpublish times.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: pageId,
    publishAt: optionalWhen.optional(),
    unpublishAt: optionalWhen.optional(),
  }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(pages).where(eq(pages.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${input.id}`);
    if (input.publishAt === undefined && input.unpublishAt === undefined) {
      throw new ServiceError("validation", "cms.schedulePage: nothing to change");
    }
    if (
      input.publishAt &&
      input.unpublishAt &&
      input.unpublishAt.getTime() <= input.publishAt.getTime()
    ) {
      throw new ServiceError(
        "validation",
        "Unpublish must be later than publish.",
      );
    }
    const [page] = await ctx.tx
      .update(pages)
      .set({
        ...(input.publishAt !== undefined ? { scheduledPublishAt: input.publishAt } : {}),
        ...(input.unpublishAt !== undefined
          ? { scheduledUnpublishAt: input.unpublishAt }
          : {}),
        version: before.version + 1,
      })
      .where(eq(pages.id, input.id))
      .returning();
    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageScheduled", {
      pageId: page!.id,
      publishAt: page!.scheduledPublishAt,
      unpublishAt: page!.scheduledUnpublishAt,
    });
    return page!;
  },
});

export const applyDueSchedules = defineService({
  name: "cms.applyDueSchedules",
  summary: "Publish and unpublish pages whose scheduled time has arrived.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const now = new Date();
    const duePublish = await ctx.tx
      .select({ id: pages.id, approvalState: pages.approvalState })
      .from(pages)
      .where(
        and(
          eq(pages.status, "draft"),
          lte(pages.scheduledPublishAt, now),
          or(eq(pages.approvalState, "none"), eq(pages.approvalState, "approved")),
        ),
      );
    const dueUnpublish = await ctx.tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.status, "published"), lte(pages.scheduledUnpublishAt, now)));

    const { publishPage } = await import("./service");
    const published: string[] = [];
    const unpublished: string[] = [];
    for (const row of duePublish) {
      await ctx.callAsSystem(publishPage, { id: row.id, published: true });
      await ctx.tx
        .update(pages)
        .set({ scheduledPublishAt: null })
        .where(eq(pages.id, row.id));
      published.push(row.id);
    }
    for (const row of dueUnpublish) {
      await ctx.callAsSystem(publishPage, { id: row.id, published: false });
      await ctx.tx
        .update(pages)
        .set({ scheduledUnpublishAt: null })
        .where(eq(pages.id, row.id));
      unpublished.push(row.id);
    }
    return { published, unpublished };
  },
});

export const requestApproval = defineService({
  name: "cms.requestApproval",
  summary: "Mark a working draft as waiting for review.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: pageId, note: z.string().trim().max(2_000).optional() }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(pages).where(eq(pages.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${input.id}`);
    const [page] = await ctx.tx
      .update(pages)
      .set({
        approvalState: "pending",
        approvalNote: input.note ?? before.approvalNote,
        approvedBy: null,
        approvedAt: null,
        version: before.version + 1,
      })
      .where(eq(pages.id, input.id))
      .returning();
    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageApprovalChanged", {
      pageId: page!.id,
      approvalState: page!.approvalState,
    });
    return page!;
  },
});

export const decideApproval = defineService({
  name: "cms.decideApproval",
  summary: "Approve or reject a page waiting for review.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: pageId,
    approved: z.boolean(),
    note: z.string().trim().max(2_000).optional(),
  }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(pages).where(eq(pages.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${input.id}`);
    if (before.approvalState !== "pending") {
      throw new ServiceError("conflict", "This page is not waiting for approval.");
    }
    const [page] = await ctx.tx
      .update(pages)
      .set({
        approvalState: input.approved ? "approved" : "rejected",
        approvalNote: input.note ?? before.approvalNote,
        approvedBy: actorString(ctx.actor),
        approvedAt: new Date(),
        version: before.version + 1,
      })
      .where(eq(pages.id, input.id))
      .returning();
    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageApprovalChanged", {
      pageId: page!.id,
      approvalState: page!.approvalState,
    });
    return page!;
  },
});

export const snapshotRevision = defineService({
  name: "cms.snapshotRevision",
  summary: "Keep a named snapshot of the current working draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId,
    name: z.string().trim().min(1).max(80),
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.pageId}`);
    const [revision] = await ctx.tx
      .insert(contentRevisions)
      .values({
        subjectType: "page",
        subjectId: page.id,
        title: page.workingTitle ?? page.title,
        blocks: page.workingBlocks ?? page.blocks,
        seo: page.workingSeo ?? page.seo,
        name: input.name,
        kind: "named",
        actor: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("page", page.id);
    ctx.queueEvent("cms.revisionNamed", { pageId: page.id, revisionId: revision!.id });
    return revision!;
  },
});

export const nameRevision = defineService({
  name: "cms.nameRevision",
  summary: "Give an existing revision a name.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ revisionId, name: z.string().trim().min(1).max(80) }),
  handler: async (input, ctx) => {
    const [revision] = await ctx.tx
      .update(contentRevisions)
      .set({ name: input.name, kind: "named" })
      .where(eq(contentRevisions.id, input.revisionId))
      .returning();
    if (!revision) throw new ServiceError("not_found", "that version no longer exists");
    ctx.setSubject(revision.subjectType, revision.subjectId);
    return revision;
  },
});

export const compareRevisions = defineService({
  name: "cms.compareRevisions",
  summary: "Title and block-tree difference between two versions.",
  kind: "query",
  permission: "scoped",
  input: z
    .object({
      pageId: pageId.optional(),
      fromRevisionId: revisionId.optional(),
      toRevisionId: revisionId.optional(),
    })
    .refine(
      (value) =>
        Boolean(value.fromRevisionId) &&
        (Boolean(value.toRevisionId) || Boolean(value.pageId)),
      "compare two revisions, or one revision against the current draft",
    ),
  handler: async (input, ctx) => {
    const [earlier] = await ctx.tx
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.id, input.fromRevisionId!))
      .limit(1);
    if (!earlier) throw new ServiceError("not_found", "the earlier version is gone");

    let laterTitle = earlier.title ?? "";
    let laterBlocks: unknown = earlier.blocks;
    let laterLabel = earlier.name ?? earlier.id;
    if (input.toRevisionId) {
      const [later] = await ctx.tx
        .select()
        .from(contentRevisions)
        .where(eq(contentRevisions.id, input.toRevisionId))
        .limit(1);
      if (!later) throw new ServiceError("not_found", "the later version is gone");
      laterTitle = later.title ?? "";
      laterBlocks = later.blocks;
      laterLabel = later.name ?? later.id;
    } else {
      const [page] = await ctx.tx
        .select()
        .from(pages)
        .where(eq(pages.id, input.pageId!))
        .limit(1);
      if (!page) throw new ServiceError("not_found", `no page with id ${input.pageId}`);
      laterTitle = page.workingTitle ?? page.title;
      laterBlocks = page.workingBlocks ?? page.blocks;
      laterLabel = "working";
    }

    const earlierMap = flattenBlocks(earlier.blocks);
    const laterMap = flattenBlocks(laterBlocks);
    const added: { id: string; type: string }[] = [];
    const removed: { id: string; type: string }[] = [];
    const changed: { id: string; type: string }[] = [];
    let unchanged = 0;
    for (const [id, node] of laterMap) {
      const prior = earlierMap.get(id);
      if (!prior) {
        added.push({ id, type: node.type });
        continue;
      }
      if (
        prior.type !== node.type ||
        JSON.stringify(prior.props) !== JSON.stringify(node.props)
      ) {
        changed.push({ id, type: node.type });
      } else {
        unchanged += 1;
      }
    }
    for (const [id, node] of earlierMap) {
      if (!laterMap.has(id)) removed.push({ id, type: node.type });
    }

    return {
      earlier: { id: earlier.id, label: earlier.name ?? earlier.id, title: earlier.title ?? "" },
      later: {
        id: input.toRevisionId ?? input.pageId ?? "working",
        label: laterLabel,
        title: laterTitle,
      },
      titleChanged: (earlier.title ?? "") !== laterTitle,
      blocks: { added, removed, changed, unchanged },
    };
  },
});

const LEASE_MS = 5 * 60 * 1000;

export const touchEditLease = defineService({
  name: "cms.touchEditLease",
  summary: "Claim or refresh the short edit lease on a page.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: pageId, steal: z.boolean().default(false) }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(pages).where(eq(pages.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${input.id}`);
    const actor = actorString(ctx.actor);
    const now = Date.now();
    const held =
      Boolean(before.editLeaseActor) &&
      Boolean(before.editLeaseUntil) &&
      before.editLeaseUntil!.getTime() > now &&
      before.editLeaseActor !== actor;
    if (held && !input.steal) {
      return {
        held: true as const,
        by: before.editLeaseActor!,
        until: before.editLeaseUntil!,
        mine: false as const,
      };
    }
    const until = new Date(now + LEASE_MS);
    await ctx.tx
      .update(pages)
      .set({ editLeaseActor: actor, editLeaseUntil: until })
      .where(eq(pages.id, input.id));
    return { held: false as const, by: actor, until, mine: true as const };
  },
});

export const releaseEditLease = defineService({
  name: "cms.releaseEditLease",
  summary: "Drop this actor's edit lease if they still hold it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: pageId }),
  handler: async (input, ctx) => {
    const actor = actorString(ctx.actor);
    await ctx.tx
      .update(pages)
      .set({ editLeaseActor: null, editLeaseUntil: null })
      .where(and(eq(pages.id, input.id), eq(pages.editLeaseActor, actor)));
    return { id: input.id };
  },
});
