// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Link-in-bio services (MASTER.md §32, §34, C9.39).
//
// The admin screen, `/api/v1/linkinbio.*`, the MCP `linkinbio_*` tools and
// the public click redirect all go through this file. The decision that
// shapes it: **a link-in-bio is a CMS page with a `linkInBio` block on it**,
// not a second content system. So every write here is a page edit, made by
// composing `cms.updatePage` and `cms.publishPage` with `ctx.call` — the
// caller's own identity, inside the caller's transaction. That buys four
// things nothing else would:
//
//   - **Permission parity.** Editing links needs this module's grant and the
//     CMS page grant, exactly as editing the page in the visual editor needs
//     the CMS grant. An agent scoped to `linkinbio.*` alone is refused at the
//     page write, with the scope it is missing named in the error.
//   - **One history.** Every change writes the page revision the editor's
//     history panel already shows, so "undo the link the agent added" is the
//     restore button an owner already knows.
//   - **One audit trail.** The `linkinbio.*` row says what was asked; the
//     `cms.updatePage` row beside it says what changed on which page.
//   - **Publishing stays honest.** A link edit goes live only when it cannot
//     drag anything else live with it: the page is already published, has no
//     other unpublished edits, and is not waiting for approval. Otherwise the
//     edit is saved to the draft and the response says why it is not live.
//
// Clicks are counted by analytics and nowhere else (§4.7, §34): the redirect
// records one `linkinbio.clicked` event through `analytics.track`, under the
// visitor's consent, and the report reads it back through
// `analytics.eventTotals`. There is no click column to disagree with the
// traffic report.
import { z } from "zod";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import {
  actorString,
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { anonymousClientKey } from "@/core/security/rate-limit";
import { getBusiness } from "@/core/settings/service";
import { siteOrigin } from "@/core/seo/origin";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { pages } from "@/modules/cms/schema";
import type { BlockNode } from "@/modules/cms/blocks/types";
import {
  createPage,
  getPage,
  publishedPaths,
  publishPage,
  resolvePageForRender,
  updatePage,
} from "@/modules/cms/service";
import { campaignTotals, eventTotals, track } from "@/modules/analytics/service";
import { availableLinks, type CallByName } from "./availability";
import {
  BIO_CLICK_EVENT,
  bioCampaign,
  clickHref,
  destinationOf,
  findLink,
  internalDestination,
  isLinkId,
  LINK_IN_BIO_BLOCK,
  LINK_KINDS,
  LINK_STATES,
  LINK_STYLES,
  linkInBioBlocks,
  linkInBioPropsSchema,
  linkState,
  MAX_LINKS,
  MAX_SOCIALS,
  mintLinkId,
  normalizeSchedule,
  normalizeTarget,
  replaceBlockProps,
  scheduleInstant,
  sitePath,
  socialHref,
  SOCIAL_NETWORKS,
  type LinkInBioProps,
  type LinkItem,
  type LinkKind,
} from "./links";

/** Where `linkinbio.setup` puts the page unless told otherwise. */
export const DEFAULT_SLUG = "links";

/* ---------------------------------------------------------------- shapes */

const linkRow = row({
  id: z.string(),
  label: z.string(),
  kind: z.enum(LINK_KINDS),
  target: z.string(),
  hidden: z.boolean(),
  startsAt: z.string(),
  endsAt: z.string(),
  /** Where it lands: an on-site path or an outside address. */
  destination: z.string().nullable(),
  external: z.boolean(),
  state: z.enum(LINK_STATES),
  /** The first-party address the public button uses. */
  clickUrl: z.string(),
});

const publicationRow = row({
  live: z.boolean(),
  /** Why a saved change is not on the public page yet. Null when it is. */
  pending: z
    .enum(["notRequested", "draftPage", "unpublishedEdits", "awaitingApproval"])
    .nullable(),
});

const pageView = row({
  page: row({
    id: uuidSchema,
    slug: z.string(),
    title: z.string(),
    status: z.enum(["draft", "published"]),
    version: z.number().int(),
    publicUrl: z.string(),
    editorPath: z.string(),
    unpublishedEdits: z.boolean(),
  }),
  blockId: z.string(),
  timezone: z.string(),
  profile: row({
    name: z.string(),
    bio: z.string(),
    avatarAssetId: z.string(),
    style: z.enum(LINK_STYLES),
    socials: listed(row({ network: z.enum(SOCIAL_NETWORKS), url: z.string() })),
  }),
  links: listed(linkRow),
});

const mutationResult = row({
  view: pageView,
  publication: publicationRow,
});

const locator = {
  /** Omit to use the site's link-in-bio page (the first page with the block). */
  pageId: uuidSchema.optional(),
  /** Omit to use the first link-in-bio block on that page. */
  blockId: z.string().trim().min(1).max(120).optional(),
};

/** `true` unless the caller says otherwise: most owners want the edit live. */
const publishFlag = z.boolean().default(true);

const linkIdField = z
  .string()
  .trim()
  .refine(isLinkId, "a link id is 4–24 lowercase letters and digits");

/* --------------------------------------------------------------- helpers */

interface Located {
  page: z.output<typeof pageRowShape>;
  tree: BlockNode[];
  block: BlockNode;
  props: LinkInBioProps;
}

// The parts of `cms.getPage`'s row this module reads.
const pageRowShape = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(["draft", "published"]),
  version: z.number(),
  blocks: z.unknown(),
  seo: z.unknown(),
  workingTitle: z.string().nullable(),
  workingBlocks: z.unknown().nullable(),
  workingSeo: z.unknown().nullable(),
  approvalState: z.enum(["none", "pending", "approved", "rejected"]),
});

function asTree(value: unknown): BlockNode[] {
  return Array.isArray(value) ? (value as BlockNode[]) : [];
}

async function businessFacts(ctx: ServiceContext) {
  const business = await ctx.callAsSystem(getBusiness, {});
  return {
    timezone: business?.timezone ?? "UTC",
    defaultLocale: business?.defaultLocale ?? "en",
    name: business?.name ?? "",
    enabledLocales: business?.enabledLocales ?? [],
  };
}

/**
 * The page the site's link-in-bio lives on, or null.
 *
 * Found by content, not by a setting: whichever page carries the block is the
 * link-in-bio page, so moving it to another address is an ordinary slug
 * change and there is no second pointer to fall out of step. A published page
 * wins over a draft, then the most recently edited.
 */
async function findPageId(ctx: ServiceContext): Promise<string | null> {
  const marker = `%"type": "${LINK_IN_BIO_BLOCK}"%`;
  const [found] = await ctx.tx
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        isNull(pages.trashedAt),
        or(
          sql`${pages.blocks}::text like ${marker}`,
          sql`coalesce(${pages.workingBlocks}, 'null'::jsonb)::text like ${marker}`,
        ),
      ),
    )
    .orderBy(sql`case when ${pages.status} = 'published' then 0 else 1 end`, desc(pages.updatedAt))
    .limit(1);
  return found?.id ?? null;
}

/** Published pages carrying a link-in-bio block, for a click with no page. */
async function publishedBioSlugs(ctx: ServiceContext): Promise<string[]> {
  const marker = `%"type": "${LINK_IN_BIO_BLOCK}"%`;
  const rows = await ctx.tx
    .select({ slug: pages.slug })
    .from(pages)
    .where(
      and(
        isNull(pages.trashedAt),
        eq(pages.status, "published"),
        sql`${pages.blocks}::text like ${marker}`,
      ),
    )
    .orderBy(desc(pages.updatedAt))
    .limit(10);
  return rows.map((row) => row.slug);
}

async function locate(
  ctx: ServiceContext,
  input: { pageId?: string; blockId?: string },
  options: { required: true },
): Promise<Located>;
async function locate(
  ctx: ServiceContext,
  input: { pageId?: string; blockId?: string },
  options: { required: false },
): Promise<Located | null>;
async function locate(
  ctx: ServiceContext,
  input: { pageId?: string; blockId?: string },
  options: { required: boolean },
): Promise<Located | null> {
  const pageId = input.pageId ?? (await findPageId(ctx));
  if (!pageId) {
    if (!options.required) return null;
    throw new ServiceError(
      "not_found",
      "This site has no link-in-bio page yet. Create one with linkinbio.setup.",
    );
  }
  // Through the CMS service, so reading the page needs the CMS grant exactly
  // as opening it in the editor does.
  const page = pageRowShape.parse(await ctx.call(getPage, { id: pageId }));
  const tree = asTree(page.workingBlocks ?? page.blocks);
  const blocks = linkInBioBlocks(tree);
  const block = input.blockId ? blocks.find((each) => each.id === input.blockId) : blocks[0];
  if (!block) {
    throw new ServiceError("not_found", "That page has no link-in-bio block.");
  }
  return { page, tree, block, props: linkInBioPropsSchema.parse(block.props) };
}

function unpublishedEdits(page: Located["page"]): boolean {
  if (page.status !== "published") return false;
  // Both sides come out of jsonb, which stores keys in one canonical order, so
  // a string comparison is a fair test of "the draft says something else".
  return (
    JSON.stringify(page.workingBlocks ?? page.blocks) !== JSON.stringify(page.blocks) ||
    (page.workingTitle ?? page.title) !== page.title ||
    JSON.stringify(page.workingSeo ?? page.seo) !== JSON.stringify(page.seo)
  );
}

const systemCall =
  (ctx: ServiceContext): CallByName =>
  (name, input) =>
    ctx.callAsSystem(getService(name), input);

async function buildView(ctx: ServiceContext, located: Located) {
  const facts = await businessFacts(ctx);
  const now = new Date();
  const { unavailable } = await availableLinks(
    located.props.links,
    facts.timezone,
    systemCall(ctx),
    now,
  );
  const origin = siteOrigin().replace(/\/+$/, "");
  const fromPath = located.page.slug === "" ? "/" : `/${located.page.slug}`;
  return {
    page: {
      id: located.page.id,
      slug: located.page.slug,
      title: located.page.title,
      status: located.page.status,
      version: located.page.version,
      publicUrl: `${origin}${fromPath}`,
      editorPath: `/admin/pages/${located.page.id}`,
      unpublishedEdits: unpublishedEdits(located.page),
    },
    blockId: located.block.id,
    timezone: facts.timezone,
    profile: {
      name: located.props.name,
      bio: located.props.bio,
      avatarAssetId: located.props.avatarAssetId,
      style: located.props.style,
      socials: located.props.socials,
    },
    links: located.props.links.map((link) => {
      const destination = destinationOf(link);
      const state = linkState(link, now, facts.timezone);
      return {
        ...link,
        destination: destination?.href ?? null,
        external: destination?.external ?? false,
        state: state === "live" && unavailable.has(link.id) ? ("unavailable" as const) : state,
        clickUrl: `${origin}${clickHref(link.id, fromPath)}`,
      };
    }),
  };
}

/**
 * Save the block, and publish only when that publishes nothing else.
 *
 * `expectedVersion` is the version this call read, so an edit made in the
 * editor in the meantime is a conflict rather than something silently
 * overwritten.
 */
async function commit(
  ctx: ServiceContext,
  located: Located,
  props: LinkInBioProps,
  publish: boolean,
) {
  const checked = linkInBioPropsSchema.parse(props);
  const hadOtherEdits = unpublishedEdits(located.page);
  const saved = pageRowShape.parse(
    await ctx.call(updatePage, {
      id: located.page.id,
      expectedVersion: located.page.version,
      blocks: replaceBlockProps(located.tree, located.block.id, checked),
    }),
  );

  let pending: z.output<typeof publicationRow>["pending"] = null;
  let current = saved;
  if (!publish) pending = "notRequested";
  else if (saved.status !== "published") pending = "draftPage";
  else if (hadOtherEdits) pending = "unpublishedEdits";
  else if (saved.approvalState === "pending") pending = "awaitingApproval";
  else {
    current = pageRowShape.parse(
      await ctx.call(publishPage, {
        id: saved.id,
        published: true,
        expectedVersion: saved.version,
      }),
    );
  }

  ctx.setSubject("page", saved.id);
  const tree = asTree(current.workingBlocks ?? current.blocks);
  const block = linkInBioBlocks(tree).find((each) => each.id === located.block.id) ?? located.block;
  const view = await buildView(ctx, {
    page: current,
    tree,
    block,
    props: linkInBioPropsSchema.parse(block.props),
  });
  return { view, publication: { live: pending === null, pending } };
}

function refuse(message: string): never {
  throw new ServiceError("validation", message);
}

function strictLabel(raw: string): string {
  const label = raw.trim();
  if (!label) refuse("A link needs a label people can read.");
  if (label.length > 120) refuse("Keep a link's label under 120 characters.");
  return label;
}

const TARGET_HELP: Record<LinkKind, string> = {
  url: "an address starting https://, http://, mailto: or tel:",
  page: "the path of a page on this site, such as about or services/weddings",
  product: "a product's address, such as products/linen-tote, or just its slug",
  event: "an event's address, such as events/spring-open-studio, or just its slug",
  newsletter: "newsletters for the sign-up page, or one issue's slug",
  gallery: "the gallery's slug, the part after /g/",
  booking: "the id of a bookable service",
};

function strictTarget(kind: LinkKind, raw: string): string {
  const target = normalizeTarget(kind, raw);
  if (target === null) refuse(`For a ${kind} link, give ${TARGET_HELP[kind]}.`);
  return target;
}

function strictSchedule(
  startsAt: string,
  endsAt: string,
  timezone: string,
): { startsAt: string; endsAt: string } {
  const start = normalizeSchedule(startsAt);
  const end = normalizeSchedule(endsAt);
  const from = scheduleInstant(start, timezone, "start");
  const until = scheduleInstant(end, timezone, "end");
  const shape =
    "Use a local time such as 2026-12-01T09:00 (read in the business's time zone), a date, or an exact time with an offset.";
  if (from === null) refuse(`The start time cannot be read. ${shape}`);
  if (until === null) refuse(`The end time cannot be read. ${shape}`);
  if (from && until && until.getTime() <= from.getTime()) {
    refuse("A link's end time has to be after its start time.");
  }
  return { startsAt: start, endsAt: end };
}

function linkOf(located: Located, id: string): { index: number; link: LinkItem } {
  const index = located.props.links.findIndex((each) => each.id === id);
  if (index < 0) throw new ServiceError("not_found", "There is no link with that id on this page.");
  return { index, link: located.props.links[index]! };
}

/* ---------------------------------------------------------------- owners */

export const page = defineService({
  name: "linkinbio.page",
  summary: "The link-in-bio page: profile, every link with why it is or is not showing, and its address.",
  kind: "query",
  permission: "scoped",
  input: z.object(locator),
  output: pageView.nullable(),
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: false });
    return located ? buildView(ctx, located) : null;
  },
});

/**
 * The starting page: the business's name, an empty bio and no links yet.
 *
 * Idempotent: an instance that already has a link-in-bio page gets that page
 * back rather than a second one, because two pages each claiming to be "the"
 * bio link is how an owner ends up editing the one nobody visits.
 */
export const setup = defineService({
  name: "linkinbio.setup",
  writeClass: "blocks",
  summary: "Create the link-in-bio page (default /links), or return the one that exists.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    slug: z.string().trim().max(120).default(DEFAULT_SLUG),
    title: z.string().trim().min(1).max(120).optional(),
    /** Make it live straight away. Off by default: an empty page is a draft. */
    publish: z.boolean().default(false),
  }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const existing = await locate(ctx, {}, { required: false });
    if (existing) {
      return {
        view: await buildView(ctx, existing),
        publication: {
          live: existing.page.status === "published" && !unpublishedEdits(existing.page),
          pending: existing.page.status === "published" ? null : ("draftPage" as const),
        },
      };
    }
    const slug = sitePath(input.slug);
    if (slug === null || slug === "") {
      refuse("Give the page its own address, such as links or hello.");
    }
    const facts = await businessFacts(ctx);
    const blockId = `link-in-bio-${mintLinkId(6)}`;
    const created = pageRowShape.parse(
      await ctx.call(createPage, {
        slug,
        locale: facts.defaultLocale,
        title: input.title ?? (facts.name ? `${facts.name} — links` : "Links"),
        blocks: [
          {
            id: blockId,
            type: LINK_IN_BIO_BLOCK,
            props: linkInBioPropsSchema.parse({}),
          },
        ],
        seo: facts.name
          ? { description: `Everything from ${facts.name} in one place.` }
          : {},
      }),
    );
    const current = input.publish
      ? pageRowShape.parse(await ctx.call(publishPage, { id: created.id, published: true }))
      : created;
    ctx.setSubject("page", created.id);
    ctx.queueEvent("linkinbio.pageCreated", { pageId: created.id, slug: created.slug });
    const located = await locate(ctx, { pageId: current.id }, { required: true });
    return {
      view: await buildView(ctx, located),
      publication: {
        live: current.status === "published",
        pending: current.status === "published" ? null : ("draftPage" as const),
      },
    };
  },
});

const linkFields = {
  label: z.string().max(200),
  kind: z.enum(LINK_KINDS).default("url"),
  /** See the kind's own rule in the refusal message; a URL for `url`. */
  target: z.string().max(600).default(""),
  hidden: z.boolean().default(false),
  /** Local time in the business's zone (2026-12-01T09:00), a date, or ISO with offset. */
  startsAt: z.string().max(40).nullish(),
  endsAt: z.string().max(40).nullish(),
};

export const addLink = defineService({
  name: "linkinbio.addLink",
  writeClass: "blocks",
  summary: "Add a link (a web address, or one of the site's own products, bookings, events, galleries, pages or newsletter).",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    ...locator,
    ...linkFields,
    /** 0 puts it first. Omit to add it last. */
    position: z.number().int().min(0).max(MAX_LINKS).optional(),
    publish: publishFlag,
  }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    if (located.props.links.length >= MAX_LINKS) {
      refuse(`A link-in-bio page holds at most ${MAX_LINKS} links.`);
    }
    const facts = await businessFacts(ctx);
    const schedule = strictSchedule(input.startsAt ?? "", input.endsAt ?? "", facts.timezone);
    const taken = new Set(located.props.links.map((each) => each.id));
    let id = mintLinkId();
    while (taken.has(id)) id = mintLinkId();
    const link: LinkItem = {
      id,
      label: strictLabel(input.label),
      kind: input.kind,
      target: strictTarget(input.kind, input.target),
      hidden: input.hidden,
      ...schedule,
    };
    const links = [...located.props.links];
    links.splice(input.position ?? links.length, 0, link);
    ctx.queueEvent("linkinbio.linkAdded", { pageId: located.page.id, linkId: id, kind: link.kind });
    return commit(ctx, located, { ...located.props, links }, input.publish);
  },
});

export const updateLink = defineService({
  name: "linkinbio.updateLink",
  writeClass: "blocks",
  summary: "Change one link's label, destination, visibility or schedule.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    ...locator,
    id: linkIdField,
    label: z.string().max(200).optional(),
    kind: z.enum(LINK_KINDS).optional(),
    target: z.string().max(600).optional(),
    hidden: z.boolean().optional(),
    /** Null or "" clears the bound. */
    startsAt: z.string().max(40).nullish(),
    endsAt: z.string().max(40).nullish(),
    publish: publishFlag,
  }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    const { index, link } = linkOf(located, input.id);
    const facts = await businessFacts(ctx);
    const kind = input.kind ?? link.kind;
    const schedule = strictSchedule(
      input.startsAt === undefined ? link.startsAt : (input.startsAt ?? ""),
      input.endsAt === undefined ? link.endsAt : (input.endsAt ?? ""),
      facts.timezone,
    );
    const next: LinkItem = {
      ...link,
      label: input.label === undefined ? link.label : strictLabel(input.label),
      kind,
      // Changing the kind re-checks the target even when it was not resent:
      // a product slug is not a web address.
      target:
        input.target !== undefined || input.kind !== undefined
          ? strictTarget(kind, input.target ?? link.target)
          : link.target,
      hidden: input.hidden ?? link.hidden,
      ...schedule,
    };
    const links = located.props.links.map((each, i) => (i === index ? next : each));
    return commit(ctx, located, { ...located.props, links }, input.publish);
  },
});

export const setLinkHidden = defineService({
  name: "linkinbio.setLinkHidden",
  writeClass: "blocks",
  summary: "Hide one link from the public page, or show it again. Its clicks and settings are kept.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ ...locator, id: linkIdField, hidden: z.boolean(), publish: publishFlag }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    const { index, link } = linkOf(located, input.id);
    const links = located.props.links.map((each, i) =>
      i === index ? { ...link, hidden: input.hidden } : each,
    );
    return commit(ctx, located, { ...located.props, links }, input.publish);
  },
});

export const scheduleLink = defineService({
  name: "linkinbio.scheduleLink",
  writeClass: "blocks",
  summary: "Set when one link starts and stops showing. Null clears a bound.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    ...locator,
    id: linkIdField,
    startsAt: z.string().max(40).nullable(),
    endsAt: z.string().max(40).nullable(),
    publish: publishFlag,
  }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    const { index, link } = linkOf(located, input.id);
    const facts = await businessFacts(ctx);
    const schedule = strictSchedule(input.startsAt ?? "", input.endsAt ?? "", facts.timezone);
    const links = located.props.links.map((each, i) => (i === index ? { ...link, ...schedule } : each));
    return commit(ctx, located, { ...located.props, links }, input.publish);
  },
});

/**
 * Put links in a new order.
 *
 * The ids given come first, in the order given; any not named keep their
 * relative order after them. So "move this one to the top" is a one-id call,
 * and a full list is a full reorder — neither can lose a link.
 */
export const reorderLinks = defineService({
  name: "linkinbio.reorderLinks",
  writeClass: "blocks",
  summary: "Reorder links: the ids given come first, in that order; the rest follow unchanged.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    ...locator,
    ids: z.array(linkIdField).min(1).max(MAX_LINKS),
    publish: publishFlag,
  }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    const byId = new Map(located.props.links.map((each) => [each.id, each]));
    if (new Set(input.ids).size !== input.ids.length) refuse("Name each link once.");
    for (const id of input.ids) {
      if (!byId.has(id)) throw new ServiceError("not_found", `There is no link ${id} on this page.`);
    }
    const named = new Set(input.ids);
    const links = [
      ...input.ids.map((id) => byId.get(id)!),
      ...located.props.links.filter((each) => !named.has(each.id)),
    ];
    return commit(ctx, located, { ...located.props, links }, input.publish);
  },
});

export const removeLink = defineService({
  name: "linkinbio.removeLink",
  writeClass: "destructive",
  summary: "Remove one link. The page's revision history keeps the previous version.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ ...locator, id: linkIdField, confirm: z.literal(true), publish: publishFlag }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    linkOf(located, input.id);
    const links = located.props.links.filter((each) => each.id !== input.id);
    ctx.queueEvent("linkinbio.linkRemoved", { pageId: located.page.id, linkId: input.id });
    return commit(ctx, located, { ...located.props, links }, input.publish);
  },
});

export const updateProfile = defineService({
  name: "linkinbio.updateProfile",
  writeClass: "blocks",
  summary: "Change the name, bio, picture, button style or social profiles shown on the link-in-bio page.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    ...locator,
    /** "" shows the business name. */
    name: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(600).optional(),
    /** A media-library image id; "" or null falls back to the site logo. */
    avatarAssetId: uuidSchema.or(z.literal("")).nullish(),
    style: z.enum(LINK_STYLES).optional(),
    socials: z
      .array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: z.string().trim().max(600) }))
      .max(MAX_SOCIALS)
      .optional(),
    publish: publishFlag,
  }),
  output: mutationResult,
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: true });
    const socials = input.socials?.filter((item) => item.url !== "");
    for (const item of socials ?? []) {
      if (socialHref(item) === null) {
        refuse(
          item.network === "email"
            ? "The email profile needs an email address."
            : `The ${item.network} profile needs a full web address starting https://.`,
        );
      }
    }
    const next: LinkInBioProps = {
      ...located.props,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.avatarAssetId !== undefined ? { avatarAssetId: input.avatarAssetId ?? "" } : {}),
      ...(input.style !== undefined ? { style: input.style } : {}),
      ...(socials !== undefined ? { socials } : {}),
    };
    return commit(ctx, located, next, input.publish);
  },
});

/**
 * What a smart link can point at, for a picker or an agent.
 *
 * Read from the registries that already answer "what is public here" — the
 * published pages (which include products, events and the newsletter
 * archive), the bookable services, and the galleries this caller may see —
 * so the list cannot offer something the site does not serve.
 */
export const targets = defineService({
  name: "linkinbio.targets",
  summary: "The site's own pages, products, events, galleries, bookable services and newsletter a link can point at.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(row({ kind: z.enum(LINK_KINDS), target: z.string(), title: z.string() })),
  handler: async (_input, ctx) => {
    const facts = await businessFacts(ctx);
    const out: Array<{ kind: LinkKind; target: string; title: string }> = [];
    const paths = await ctx.callAsSystem(publishedPaths, { locale: facts.defaultLocale });
    for (const entry of paths) {
      const kind: LinkKind =
        entry.kind === "product"
          ? "product"
          : entry.kind === "event"
            ? "event"
            : entry.slug === "newsletters" || entry.kind === "newsletter"
              ? "newsletter"
              : "page";
      out.push({ kind, target: entry.slug, title: entry.title });
    }
    try {
      const services = (await ctx.callAsSystem(getService("catalog.bookableServices"), {})) as {
        services: Array<{ productId: string; name: string }>;
      };
      for (const service of services.services) {
        out.push({ kind: "booking", target: service.productId, title: service.name });
      }
    } catch {
      // Catalog is off; there is nothing to book.
    }
    try {
      // The caller's own permission: galleries are private deliveries, and a
      // role that cannot see them should not learn their addresses here.
      const galleries = (await ctx.call(getService("galleries.list"), { limit: 200 })) as Array<{
        slug: string;
        title: string;
      }>;
      for (const gallery of galleries) {
        out.push({ kind: "gallery", target: gallery.slug, title: gallery.title });
      }
    } catch {
      // Galleries off, or not this caller's to see.
    }
    return out;
  },
});

/**
 * What each link has done.
 *
 * Clicks and the people behind them come from the analytics ledger; for
 * links to the site's own pages, visitors and enquiries attributed to the
 * link come from the campaign the redirect stamped on the way in. Elevated,
 * with the greppable name, for the reason `share.linkReport` gives: somebody
 * granted this screen may ask how these links did without being granted the
 * whole traffic report, and both audit rows are still written.
 */
export const report = defineService({
  name: "linkinbio.report",
  summary: "Clicks, unique visitors and attributed conversions for every link, over a window of days.",
  kind: "query",
  permission: "scoped",
  input: z.object({ ...locator, days: z.number().int().min(1).max(365).default(30) }),
  output: row({
    days: z.number().int(),
    totalClicks: z.number().int(),
    links: listed(
      row({
        id: z.string(),
        label: z.string(),
        kind: z.enum(LINK_KINDS),
        state: z.enum(LINK_STATES),
        clicks: z.number().int(),
        visitors: z.number().int(),
        /** Visitors this link brought to an on-site page (last touch). */
        arrivals: z.number().int(),
        /** Of those, how many went on to send a form. */
        conversions: z.number().int(),
      }),
    ),
  }).nullable(),
  handler: async (input, ctx) => {
    const located = await locate(ctx, input, { required: false });
    if (!located) return null;
    const view = await buildView(ctx, located);
    const ids = view.links.map((link) => link.id);
    if (ids.length === 0) return { days: input.days, totalClicks: 0, links: [] };
    const clicks = await ctx.callAsSystem(eventTotals, {
      name: BIO_CLICK_EVENT,
      prop: "linkId",
      values: ids,
      days: input.days,
    });
    const campaigns = await ctx.callAsSystem(campaignTotals, {
      campaigns: ids.map(bioCampaign),
      days: input.days,
    });
    const clickBy = new Map(clicks.map((each) => [each.value, each]));
    const campaignBy = new Map(campaigns.map((each) => [each.campaign, each]));
    const links = view.links.map((link) => ({
      id: link.id,
      label: link.label,
      kind: link.kind,
      state: link.state,
      clicks: clickBy.get(link.id)?.events ?? 0,
      visitors: clickBy.get(link.id)?.visitors ?? 0,
      arrivals: campaignBy.get(bioCampaign(link.id))?.visitors ?? 0,
      conversions: campaignBy.get(bioCampaign(link.id))?.conversions ?? 0,
    }));
    return {
      days: input.days,
      totalClicks: links.reduce((sum, link) => sum + link.clicks, 0),
      links,
    };
  },
});

/* ---------------------------------------------------------------- public */

/**
 * Follow one link: count it, and say where it goes.
 *
 * The click redirect's whole decision, kept here so it is a function a test
 * can call rather than a route nobody can. The destination comes only from
 * the published page — `from` selects *which* page to look on and nothing
 * else — so there is no input that can make this send anybody somewhere the
 * owner did not write down. An unknown id, a hidden or expired link, and a
 * page that is not published all get the same answer, so a stranger cannot
 * use this to learn which links exist.
 *
 * Counting is analytics' job, under analytics' consent rules: the route only
 * passes visitor identifiers when the visitor's policy allows collection,
 * and without them the visitor still travels, uncounted.
 */
export const follow = defineService({
  name: "linkinbio.follow",
  writeClass: "write",
  summary: "Count a click on a link-in-bio link and return where it goes.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    id: z.string().trim().min(1).max(40),
    /** The public path of the page the link was on. */
    from: z.string().trim().max(400).default("/"),
    lang: z.string().trim().min(2).max(20).optional(),
    /** Supplied only when the visitor's analytics policy permits it. */
    anonId: z.string().trim().min(1).max(64).nullish(),
    sessionId: z.string().trim().min(1).max(64).nullish(),
    visitorKind: z.enum(["human", "bot", "suspected"]).default("human"),
    botReasons: z.array(z.string().max(200)).max(10).default([]),
  }),
  output: row({ destination: z.string() }),
  rateLimit: {
    limit: 300,
    windowSeconds: 10 * 60,
    subject: (_input, actor) =>
      actor.kind === "user" || actor.kind === "agent" ? actorString(actor) : anonymousClientKey(actor),
    untrustedBackstop: { limit: 10_000, windowSeconds: 10 * 60 },
    message: "That is a lot of clicks at once. Wait a few minutes and try again.",
  },
  handler: async (input, ctx) => {
    const gone = () => new ServiceError("not_found", "That link is not available.");
    const slug = sitePath(input.from);
    if (slug === null || !isLinkId(input.id)) throw gone();
    const facts = await businessFacts(ctx);
    const locale = input.lang && facts.enabledLocales.includes(input.lang) ? input.lang : facts.defaultLocale;
    // The page the button was on first. A click whose `from` was lost (a
    // shortened or re-shared address) is looked up on the site's other
    // published link-in-bio pages; either way the link must be on a
    // published page to be followed.
    let found: ReturnType<typeof findLink> = null;
    let pageSlug = slug;
    for (const candidate of [slug, ...(await publishedBioSlugs(ctx)).filter((each) => each !== slug)]) {
      const published = await ctx.callAsSystem(resolvePageForRender, { slug: candidate, locale });
      found = published ? findLink(asTree(published.blocks), input.id) : null;
      if (found) {
        pageSlug = candidate;
        break;
      }
    }
    if (!found) throw gone();
    const { shown } = await availableLinks([found.link], facts.timezone, systemCall(ctx));
    if (shown.length === 0) throw gone();

    const target = destinationOf(found.link);
    if (!target) throw gone();
    let destination: string | null;
    if (target.external) {
      destination = target.href;
    } else {
      const href =
        locale === facts.defaultLocale
          ? target.href
          : localizeCustomerHref(target.href, locale, {
              defaultLocale: facts.defaultLocale,
              enabledLocales: facts.enabledLocales,
            });
      destination = internalDestination(href, found.link.id, siteOrigin());
    }
    if (!destination) throw gone();

    if (input.anonId && input.sessionId) {
      await ctx.call(track, {
        anonId: input.anonId,
        sessionId: input.sessionId,
        name: BIO_CLICK_EVENT,
        // A double tap and a retried request are one click; a second visit
        // an hour later is another.
        eventKey: `${BIO_CLICK_EVENT}:${input.anonId}:${found.link.id}:${Math.floor(Date.now() / 60_000)}`,
        path: pageSlug === "" ? "/" : `/${pageSlug}`,
        locale,
        props: { linkId: found.link.id, kind: found.link.kind },
        visitorKind: input.visitorKind,
        botReasons: input.botReasons,
      });
    }
    ctx.setSubject("link_in_bio_link", found.link.id);
    return { destination };
  },
  // A click is traffic, not an owner's act. Its record is the analytics
  // event; an audit row per tap would bury the audit log in strangers.
  auditWhen: () => false,
});

export default [
  page,
  setup,
  addLink,
  updateLink,
  setLinkHidden,
  scheduleLink,
  reorderLinks,
  removeLink,
  updateProfile,
  targets,
  report,
  follow,
];
