// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sharing, as a property of every public entity (MASTER.md §34, C9.28).
//
// Three decisions shape this file, and each of them was a fork in the road.
//
// **The set of shareable things is not stored.** §34 says sharing is "a
// property of every entity with a public face", and the platform already
// answers "which entities have a public face" exactly once, in the SEO entity
// registry every module feeds (§5, C2.21). Keeping a second list here would
// have meant a product published on Tuesday was shareable on the sitemap and
// invisible to the share bar until something synced. So a `share_targets` row
// is only ever a *decision an owner made* — sharing switched off, a social
// headline written — plus the anchor a tracked link hangs from. No row means
// "shareable, described by the page itself".
//
// **The control is enforced at the redirect, not only at the button.** An
// owner who switches sharing off for a gallery has not asked to stop new
// buttons appearing; they have asked for that gallery to stop circulating.
// `resolveLink` therefore refuses links that were minted while sharing was on,
// which is the only reading of the setting that means anything the day after
// somebody changes their mind.
//
// **The clicks are counted by analytics and nowhere else.** There is no
// `clicks` column and no `share_click` table. `/s/<ref>` redirects to the
// entity's own URL carrying `utm_medium=share`, the page records its own view
// through the machinery that already exists, and the report here composes
// `analytics.campaignTotals` rather than counting anything itself. The cost is
// real and is stated on the admin screen: a visitor who has declined analytics
// is not counted, exactly as they are not counted anywhere else. The
// alternative — a counter of our own — buys a number that disagrees with the
// traffic report, and a business cannot use two.
import { z } from "zod";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { businessProfile } from "@/core/settings/schema";
import { siteOrigin } from "@/core/seo/origin";
import { shareTargets, sharedLinks } from "./schema";
import {
  channelsFor,
  intentUrl,
  isOnSiteChannel,
  shareChannelSchema,
  shareText,
  SHARE_CHANNELS,
  type ShareChannel,
} from "./intents";
import {
  campaignFor,
  canonicalShareUrl,
  destinationFor,
  internalPath,
  mintRef,
  refFromCampaign,
  shortLinkUrl,
} from "./links";

export { SHARE_CHANNELS, channelsFor, intentUrl, shareText } from "./intents";
export {
  campaignFor,
  canonicalShareUrl,
  internalPath,
  refFromCampaign,
  shortLinkUrl,
  SHARE_MEDIUM,
} from "./links";
export type { ShareChannel } from "./intents";

const pathField = z.string().max(400);
const localeField = z.string().trim().min(2).max(20).default("en");

const targetRow = row({
  id: uuidSchema.nullable(),
  entityKind: z.string(),
  path: z.string(),
  locale: z.string(),
  shareable: z.boolean(),
  channels: listed(z.string()),
  socialTitle: z.string().nullable(),
  socialDescription: z.string().nullable(),
  imageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
});

/** A path this instance serves, or a refusal a person can read. */
function requirePath(raw: string): string {
  const clean = internalPath(raw);
  if (clean === null) {
    throw new ServiceError(
      "validation",
      "A share target is a page on this site, written as a path. An address somewhere else is not something this site can share.",
    );
  }
  return clean;
}

/** The stored decision about one path, if an owner has made one. */
async function storedTarget(ctx: ServiceContext, path: string, locale: string) {
  const [found] = await ctx.tx
    .select()
    .from(shareTargets)
    .where(and(eq(shareTargets.path, path), eq(shareTargets.locale, locale)))
    .limit(1);
  return found ?? null;
}

/**
 * The contact behind whoever is sharing, or nobody.
 *
 * Derived from the session, never accepted as input. A public mutation that
 * took a `contactId` would let any visitor file their share under somebody
 * else's name — and since a sharer is a Contact on the spine like everybody
 * else, that is not a cosmetic lie but a forged row in the customer record.
 * Most sharing is anonymous, and null is the honest answer for it.
 */
async function sharerContactId(ctx: ServiceContext): Promise<string | null> {
  if (ctx.actor.kind !== "user") return null;
  const [found] = await ctx.tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, ctx.actor.userId))
    .limit(1);
  return found?.id ?? null;
}

/** The business's own name, for copy-with-attribution. */
async function siteName(ctx: ServiceContext): Promise<string | null> {
  const [found] = await ctx.tx
    .select({ name: businessProfile.name })
    .from(businessProfile)
    .limit(1);
  return found?.name ?? null;
}

/**
 * What sharing this path means right now.
 *
 * Public because the caller is a page render serving an anonymous visitor.
 * It reads and writes nothing, which is what makes a public query safe.
 */
export const targetFor = defineService({
  name: "share.targetFor",
  summary: "Whether a page may be shared, and how it should look when it is.",
  kind: "query",
  permission: "public",
  input: z.object({ path: pathField, locale: localeField }),
  output: targetRow,
  handler: async (input, ctx) => {
    const path = requirePath(input.path);
    const found = await storedTarget(ctx, path, input.locale);
    return {
      id: found?.id ?? null,
      entityKind: found?.entityKind ?? "page",
      path,
      locale: input.locale,
      // The default, and the reason there is no row for most things.
      shareable: found?.shareable ?? true,
      channels: channelsFor(found?.channels ?? []),
      socialTitle: found?.socialTitle ?? null,
      socialDescription: found?.socialDescription ?? null,
      imageUrl: found?.imageUrl ?? null,
      canonicalUrl: canonicalShareUrl(path),
    };
  },
});

/**
 * Mint one tracked link and say where the button should send somebody.
 *
 * Public and a mutation, which is unusual enough to justify. Sharing is an
 * *act*: one person deciding to send one thing to one channel, and §34 wants
 * that act counted ("this gallery was shared 12 times"). A query could not
 * count it, and minting the links up front at render time would count
 * intentions rather than shares — every page view would look like ten shares.
 *
 * It writes one row and reads three, and it can reach no other table, which is
 * what makes a public write safe to leave open. The rate limit is there for
 * the other reason: a public insert with no ceiling is somebody's afternoon.
 */
export const shareVia = defineService({
  name: "share.shareVia",
  writeClass: "write",
  summary: "Record a share and return the tracked link for one channel.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    path: pathField,
    locale: localeField,
    channel: shareChannelSchema,
    /**
     * Only ever the text *inside* an encoded query parameter of a fixed host
     * (see `intents.ts`). It cannot change where the visitor lands.
     */
    title: z.string().trim().max(200).default(""),
  }),
  output: row({
    ref: z.string(),
    url: z.string(),
    canonicalUrl: z.string(),
    channel: z.string(),
    intentUrl: z.string().nullable(),
    text: z.string(),
  }),
  rateLimit: {
    limit: 60,
    windowSeconds: 15 * 60,
    subject: (input) => `share:${input.path}`,
    message: "That is a lot of sharing at once. Wait a few minutes and try again.",
  },
  handler: async (input, ctx) => {
    const path = requirePath(input.path);
    const canonical = canonicalShareUrl(path);
    if (canonical === null) {
      throw new ServiceError("validation", "That is not an address this site serves.");
    }

    const existing = await storedTarget(ctx, path, input.locale);
    if (existing && !existing.shareable) {
      throw new ServiceError(
        "permission",
        "Sharing is switched off for this one.",
      );
    }
    const allowed = channelsFor(existing?.channels ?? []);
    if (!allowed.includes(input.channel)) {
      throw new ServiceError(
        "permission",
        "This one is not shared through that channel.",
      );
    }

    // The anchor for the link. `onConflictDoUpdate` rather than a plain insert
    // because two people may share the same page in the same second, and a
    // unique violation would abort the whole transaction rather than return
    // the row that already answers the question.
    const [target] = existing
      ? [existing]
      : await ctx.tx
          .insert(shareTargets)
          .values({ path, locale: input.locale })
          .onConflictDoUpdate({
            target: [shareTargets.path, shareTargets.locale],
            set: { updatedAt: new Date() },
          })
          .returning();
    if (!target) {
      throw new ServiceError("internal", "The share target could not be recorded.");
    }

    const ref = mintRef();
    const [link] = await ctx.tx
      .insert(sharedLinks)
      .values({
        targetId: target.id,
        ref,
        channel: input.channel,
        sharerContactId: await sharerContactId(ctx),
      })
      .returning();
    if (!link) {
      throw new ServiceError("internal", "The share could not be recorded.");
    }

    ctx.setSubject("share_link", link.id);
    ctx.queueEvent("share.linkCreated", {
      linkId: link.id,
      ref: link.ref,
      channel: link.channel,
      path: target.path,
      contactId: link.sharerContactId,
    });

    const url = shortLinkUrl(ref);
    const text = shareText(
      input.title || target.socialTitle || path || "",
      await siteName(ctx),
    );
    return {
      ref,
      url,
      canonicalUrl: canonical,
      channel: input.channel,
      intentUrl: isOnSiteChannel(input.channel) ? null : intentUrl(input.channel, url, text),
      text,
    };
  },
});

/**
 * Where `/s/<ref>` sends somebody, or null.
 *
 * The security of the public redirect is here and in `links.ts`, and it is
 * deliberately a *query* that returns a URL rather than a route that builds
 * one: the rule "a share link can only point at a page this instance serves"
 * is then one testable function rather than something asserted about a route
 * handler nobody can call from a test.
 *
 * Null covers three different situations on purpose — an unknown ref, a target
 * whose sharing was switched off after the link went out, and a stored path
 * that is not ours. A caller that distinguished them would be telling a
 * stranger which refs exist.
 */
export const resolveLink = defineService({
  name: "share.resolveLink",
  summary: "Where a tracked short link leads.",
  kind: "query",
  permission: "public",
  input: z.object({ ref: z.string().trim().min(1).max(64) }),
  output: row({
    destination: z.string(),
    channel: z.string(),
    path: z.string(),
  }).nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({
        ref: sharedLinks.ref,
        channel: sharedLinks.channel,
        path: shareTargets.path,
        shareable: shareTargets.shareable,
      })
      .from(sharedLinks)
      .innerJoin(shareTargets, eq(shareTargets.id, sharedLinks.targetId))
      .where(eq(sharedLinks.ref, input.ref))
      .limit(1);
    if (!found) return null;

    // The entity-level control, enforced against a link already in the world.
    // Refusing only at the button would have made "stop sharing this" mean
    // "stop offering new buttons", which is not what the owner asked for.
    if (!found.shareable) return null;

    const destination = destinationFor({
      path: found.path,
      ref: found.ref,
      channel: found.channel as ShareChannel,
    });
    if (destination === null) return null;
    return { destination, channel: found.channel, path: found.path };
  },
});

/* --------------------------------------------------------------- the owner */

const ownerTargetRow = row({
  id: uuidSchema,
  entityKind: z.string(),
  path: z.string(),
  locale: z.string(),
  shareable: z.boolean(),
  channels: listed(z.string()),
  socialTitle: z.string().nullable(),
  socialDescription: z.string().nullable(),
  imageUrl: z.string().nullable(),
  shares: z.number().int(),
  updatedAt: timestamp,
});

export const targets = defineService({
  name: "share.targets",
  summary: "Every page an owner has said something about sharing.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(ownerTargetRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: shareTargets.id,
        entityKind: shareTargets.entityKind,
        path: shareTargets.path,
        locale: shareTargets.locale,
        shareable: shareTargets.shareable,
        channels: shareTargets.channels,
        socialTitle: shareTargets.socialTitle,
        socialDescription: shareTargets.socialDescription,
        imageUrl: shareTargets.imageUrl,
        updatedAt: shareTargets.updatedAt,
        shares: count(sharedLinks.id),
      })
      .from(shareTargets)
      .leftJoin(sharedLinks, eq(sharedLinks.targetId, shareTargets.id))
      .groupBy(shareTargets.id)
      .orderBy(shareTargets.path);
    return rows.map((each) => ({ ...each, shares: Number(each.shares) }));
  },
});

/**
 * Say something about how one page is shared.
 *
 * The only writer of the entity-level control. `imageUrl` is refused unless it
 * is one of ours or a full address the owner typed deliberately — a social
 * card is fetched by other people's crawlers, so an owner pasting a hotlink is
 * their decision, but a *path* has to resolve here.
 */
export const saveTarget = defineService({
  name: "share.saveTarget",
  writeClass: "write",
  summary: "Turn sharing on or off for one page, or give it its own card.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    path: pathField,
    locale: localeField,
    entityKind: z.string().trim().max(40).default("page"),
    shareable: z.boolean().default(true),
    channels: z.array(shareChannelSchema).max(SHARE_CHANNELS.length).default([]),
    socialTitle: z.string().trim().max(200).nullish(),
    socialDescription: z.string().trim().max(400).nullish(),
    imageUrl: z.string().trim().max(600).nullish(),
  }),
  output: ownerTargetRow,
  handler: async (input, ctx) => {
    const path = requirePath(input.path);
    const values = {
      path,
      locale: input.locale,
      entityKind: input.entityKind,
      shareable: input.shareable,
      // Every channel ticked is the same as none ticked — "all of them" — and
      // storing it as the empty default keeps one meaning for one state.
      channels:
        input.channels.length === SHARE_CHANNELS.length ? [] : [...input.channels],
      socialTitle: input.socialTitle || null,
      socialDescription: input.socialDescription || null,
      imageUrl: input.imageUrl || null,
    };
    const [saved] = await ctx.tx
      .insert(shareTargets)
      .values(values)
      .onConflictDoUpdate({
        target: [shareTargets.path, shareTargets.locale],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    if (!saved) throw new ServiceError("internal", "That could not be saved.");
    ctx.setSubject("share_target", saved.id);
    ctx.queueEvent("share.targetChanged", {
      targetId: saved.id,
      path: saved.path,
      shareable: saved.shareable,
    });
    const [shares] = await ctx.tx
      .select({ value: count() })
      .from(sharedLinks)
      .where(eq(sharedLinks.targetId, saved.id));
    return { ...saved, shares: Number(shares?.value ?? 0) };
  },
});

export const forgetTarget = defineService({
  name: "share.forgetTarget",
  writeClass: "destructive",
  summary: "Drop a page's share settings and its tracked links.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: okResult,
  handler: async (input, ctx) => {
    const [gone] = await ctx.tx
      .delete(shareTargets)
      .where(eq(shareTargets.id, input.id))
      .returning({ id: shareTargets.id });
    if (!gone) throw new ServiceError("not_found", "There is no such share target.");
    ctx.setSubject("share_target", gone.id);
    return { ok: true };
  },
});

const totalsSchema = z.array(
  z.object({
    campaign: z.string(),
    visitors: z.number(),
    conversions: z.number(),
  }),
);

/**
 * What the tracked links have actually done.
 *
 * The share rows say how often something was sent; analytics says what came
 * back. Neither number is computed twice, and that is why they can be read
 * side by side without an argument about which one is right.
 */
export const linkReport = defineService({
  name: "share.linkReport",
  summary: "Tracked share links, with the visitors and conversions they brought.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    row({
      id: uuidSchema,
      ref: z.string(),
      url: z.string(),
      channel: z.string(),
      path: z.string(),
      entityKind: z.string(),
      shareable: z.boolean(),
      sharerContactId: uuidSchema.nullable(),
      sharerName: z.string().nullable(),
      createdAt: timestamp,
      visitors: z.number().int(),
      conversions: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: sharedLinks.id,
        ref: sharedLinks.ref,
        channel: sharedLinks.channel,
        createdAt: sharedLinks.createdAt,
        sharerContactId: sharedLinks.sharerContactId,
        sharerName: contacts.name,
        path: shareTargets.path,
        entityKind: shareTargets.entityKind,
        shareable: shareTargets.shareable,
      })
      .from(sharedLinks)
      .innerJoin(shareTargets, eq(shareTargets.id, sharedLinks.targetId))
      .leftJoin(contacts, eq(contacts.id, sharedLinks.sharerContactId))
      .orderBy(desc(sharedLinks.createdAt))
      .limit(input.limit);
    if (rows.length === 0) return [];

    // Composed rather than queried: analytics owns what a visitor is.
    //
    // Elevated, and deliberately with the greppable name. Somebody granted the
    // sharing screen has been authorised to ask "what did these links do";
    // they have not necessarily been granted the traffic module, and a role
    // that could see the links but never their numbers would show an owner a
    // table of zeros with no explanation. The elevation is narrow — a
    // read of totals for refs this query already selected — and both audit
    // rows are still written.
    const totals = totalsSchema.parse(
      await ctx.callAsSystem(getService("analytics.campaignTotals"), {
        campaigns: rows.map((each) => campaignFor(each.ref)),
        days: input.days,
      }),
    );
    const byRef = new Map(
      totals.map((each) => [refFromCampaign(each.campaign) ?? "", each]),
    );

    const origin = siteOrigin();
    return rows.map((each) => ({
      ...each,
      url: shortLinkUrl(each.ref, origin),
      visitors: Number(byRef.get(each.ref)?.visitors ?? 0),
      conversions: Number(byRef.get(each.ref)?.conversions ?? 0),
    }));
  },
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "shared_links",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(sharedLinks)
      .set({ sharerContactId: survivingId })
      .where(eq(sharedLinks.sharerContactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: sharedLinks.id })
      .from(sharedLinks)
      .where(eq(sharedLinks.sharerContactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    if (moved.length === 0) return;
    await tx
      .update(sharedLinks)
      .set({ sharerContactId: duplicateId })
      .where(
        inArray(
          sharedLinks.id,
          moved.map((each) => each.id),
        ),
      );
  },
});

registerContactPrivacySource({
  scope: "contact.sharing",
  tables: ["shared_links"],
  exportData: (tx, contactId) =>
    tx.select().from(sharedLinks).where(eq(sharedLinks.sharerContactId, contactId)),
  erase: async (tx, contactId) => {
    // The link survives with its person removed, the way an attribution touch
    // does. Two different people are owed something here and both are owed it:
    // the sharer, whose connection to the business is theirs to withdraw, and
    // whoever is holding the link — deleting the row would break a URL a third
    // party is using, which is not this person's to break.
    const rows = await tx
      .update(sharedLinks)
      .set({ sharerContactId: null })
      .where(eq(sharedLinks.sharerContactId, contactId))
      .returning({ id: sharedLinks.id });
    return { affected: rows.length };
  },
});

export default [
  targetFor,
  shareVia,
  resolveLink,
  targets,
  saveTarget,
  forgetTarget,
  linkReport,
];
