// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";
import { registerBlock } from "@/modules/cms/blocks/registry";
import { subscribePublicNewsletter } from "../../../app/(public)/newsletter-actions";

export const newsletterArchive = defineBlock({
  type: "newsletterArchive",
  labelKey: "cms.block.newsletterArchive",
  contexts: ["page"],
  schema: z.object({}),
  starter: () => ({}),
  resolve: async () => {
    const { listPublicIssues } = await import("./service");
    return listPublicIssues.call({}, { kind: "anonymous" });
  },
  render: ({ resolved, ctx }) => {
    if (!resolved || resolved.length === 0) return null;
    return (
      <ul className="grid list-none gap-4 p-0">
        {resolved.map((issue) => (
          <li key={issue.id} className="border-b border-rule pb-4 last:border-0">
            <a
              href={ctx.localizeHref?.(`/newsletters/${issue.slug}`) ?? `/newsletters/${issue.slug}`}
              className="font-semibold text-ink"
            >
              {issue.title}
            </a>
            {issue.excerpt ? <p className="mt-1 text-sm text-ink-muted">{issue.excerpt}</p> : null}
          </li>
        ))}
      </ul>
    );
  },
});

export const newsletterIssue = defineBlock({
  type: "newsletterIssue",
  labelKey: "cms.block.newsletterIssue",
  contexts: ["page"],
  schema: z.object({
    issueId: z.string().uuid(),
    slug: z.string().min(1),
  }),
  starter: () => ({ issueId: "00000000-0000-4000-8000-000000000000", slug: "issue" }),
  resolve: async (props) => {
    const { resolvePublicIssue } = await import("./service");
    return resolvePublicIssue.call({ slug: props.slug }, { kind: "anonymous" });
  },
  render: ({ resolved }) => {
    if (!resolved) return null;
    return (
      <div className="grid max-w-prose gap-4 text-ink-muted">
        {resolved.excerpt ? <p className="text-lg">{resolved.excerpt}</p> : null}
        {resolved.body
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
      </div>
    );
  },
});

export const newsletterSubscribe = defineBlock({
  type: "newsletterSubscribe",
  labelKey: "cms.block.newsletterSubscribe",
  contexts: ["page"],
  schema: z.object({
    newsletterId: z.string().uuid().optional(),
  }),
  starter: () => ({}),
  resolve: async (props) => {
    const { listPublicNewsletters } = await import("./service");
    const rows = await listPublicNewsletters.call({}, { kind: "anonymous" });
    const active = rows.filter((row) => row.status === "active");
    if (props.newsletterId) return active.filter((row) => row.id === props.newsletterId);
    return active;
  },
  render: ({ resolved, ctx }) => {
    if (!resolved || resolved.length === 0) return null;
    if (ctx.query?.subscribed === "1") {
      return (
        <p role="status" className="max-w-prose rounded-md border border-rule bg-success-soft px-4 py-3 text-sm text-success">
          {ctx.t("newsletters.confirmPending")}
        </p>
      );
    }
    return (
      <form action={subscribePublicNewsletter} className="grid max-w-md gap-3">
        {resolved.length === 1 ? (
          <input type="hidden" name="newsletterId" value={resolved[0]!.id} />
        ) : (
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-ink">{ctx.t("newsletters.name")}</span>
            <select name="newsletterId" required className="rounded-md border border-rule bg-surface px-3 py-2">
              {resolved.map((newsletter) => (
                <option key={newsletter.id} value={newsletter.id}>
                  {newsletter.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink">{ctx.t("newsletters.email")}</span>
          <input
            type="email"
            name="email"
            required
            className="rounded-md border border-rule bg-surface px-3 py-2"
          />
        </label>
        <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent">
          {ctx.t("newsletters.subscribe")}
        </button>
      </form>
    );
  },
});

registerBlock(newsletterArchive as never);
registerBlock(newsletterIssue as never);
registerBlock(newsletterSubscribe as never);

export default [newsletterArchive, newsletterIssue, newsletterSubscribe];
