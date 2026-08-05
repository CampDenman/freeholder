// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Location pages (MASTER.md §4.10, §5, §32).
//
// §4.10 asks for two things this file provides: a `LocationPage` with
// "auto-generated blocks (jsonb, owner-editable)", and — for a multi-location
// business — "`/locations/` as a root-linked index page with each location one
// hop below, RIBA-compliant by construction".
//
// The important word is *page*. §32 already settled how a public URL comes to
// exist: "structure is data; code is vocabulary", one catch-all route, a new
// page is an INSERT. So a location page is a cms page like any other — it
// appears in the sitemap, it can be translated, it can be edited, and an owner
// who rewrites it entirely has not fought the platform. The alternative, a
// route that renders a location row, would have made location pages the one
// kind of page an owner could not touch.
//
// The direction of the dependency is what makes this file live in cms rather
// than in core. core/locations knows nothing about pages; it announces that a
// location exists, and cms — which already depends on core — answers by
// writing one. Neither imports the other (§11).
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { pages } from "./schema";
import { createPage, updatePage } from "./service";
import type { BlockNode } from "./blocks/types";

const SYSTEM = { kind: "system" } as const;

/** The index every location page sits one hop below (§5's RIBA rule). */
export const INDEX_SLUG = "locations";

function pathFor(slug: string): string {
  return `${INDEX_SLUG}/${slug}`;
}

/**
 * What a location page contains before anyone edits it.
 *
 * An H1 and the NAP block, and deliberately little else: the blocks a location
 * page eventually wants — a map, its own gallery, the services offered there —
 * belong to modules that do not exist yet, and §5 is explicit that
 * "thin-template mass generation is explicitly out of scope". Two real blocks
 * an owner will add to beats six placeholder ones they have to delete.
 */
function locationBlocks(locationId: string, name: string): BlockNode[] {
  return [
    { id: "location-h1", type: "heading", props: { text: name, level: 1, align: "start" } },
    {
      id: "location-nap",
      type: "nap",
      props: {
        locationId,
        showAddress: true,
        showPhone: true,
        showEmail: true,
        showHours: true,
      },
    },
  ];
}

/** The index page's own content: a heading and the live list. */
function indexBlocks(title: string): BlockNode[] {
  return [
    { id: "locations-h1", type: "heading", props: { text: title, level: 1, align: "start" } },
    { id: "locations-list", type: "locationsIndex", props: {} },
  ];
}

/**
 * What to call a location's page.
 *
 * The place, not the business. For the common case — one location, named after
 * the business — titling it by name produced "Aurora Coast Photography ·
 * Aurora Coast Photography" once the layout appended the site name, and §5
 * wants a unique title on every page. The town is also what somebody searching
 * for a photographer in Courtenay actually typed.
 */
function titleFor(location: { name: string; city: string | null }): string {
  return location.city ?? location.name;
}

async function pageAt(slug: string, locale: string) {
  const [page] = await db()
    .select({ id: pages.id, slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.locale, locale)))
    .limit(1);
  return page ?? null;
}

/**
 * Make sure `/locations/` exists.
 *
 * Called on every location creation rather than once, because "once" has no
 * hook to hang on: an instance that adds its first location a year after setup
 * still needs the index, and an instance that never adds one must never get it
 * (§4.10 — no empty local scaffolding).
 */
async function ensureIndex(locale: string): Promise<void> {
  if (await pageAt(INDEX_SLUG, locale)) return;
  await createPage.call(
    {
      slug: INDEX_SLUG,
      locale,
      title: "Locations",
      blocks: indexBlocks("Locations"),
    },
    SYSTEM,
  );
  const created = await pageAt(INDEX_SLUG, locale);
  if (created) {
    const { publishPage } = await import("./service");
    await publishPage.call({ id: created.id, published: true }, SYSTEM);
  }
}

/**
 * A new location gets a page (§4.10's LocationPage).
 *
 * Published immediately, because a location an owner has just entered is a
 * fact about the business rather than a draft — and an unpublished page would
 * leave the address the admin screen links to answering 404.
 */
export async function onLocationCreated(payload: unknown): Promise<void> {
  const { id, slug } = payload as { id: string; slug: string };
  const { getLocation } = await import("@/core/locations/service");
  const location = await getLocation.call({ id }, SYSTEM);
  if (!location || location.status !== "visible") return;

  const locale = await defaultLocale();
  await ensureIndex(locale);

  if (await pageAt(pathFor(slug), locale)) return;
  await createPage.call(
    {
      slug: pathFor(slug),
      locale,
      title: titleFor(location),
      blocks: locationBlocks(id, location.name),
    },
    SYSTEM,
  );
  const page = await pageAt(pathFor(slug), locale);
  if (page) {
    const { publishPage } = await import("./service");
    await publishPage.call({ id: page.id, published: true }, SYSTEM);
  }
}

/**
 * A location that moves takes its page with it.
 *
 * The redirect is `cms.updatePage`'s, not this file's: it already records one
 * whenever a slug changes, and duplicating that here would be a second place
 * for §5's "slugs never silently break" to be got right or wrong.
 */
export async function onLocationUpdated(payload: unknown): Promise<void> {
  const { id, slug } = payload as { id: string; slug?: string };
  if (!slug) return;

  const { getLocation } = await import("@/core/locations/service");
  const location = await getLocation.call({ id }, SYSTEM);
  if (!location) return;

  const locale = await defaultLocale();
  const target = pathFor(slug);
  if (await pageAt(target, locale)) return;

  // Find this location's page by the block that names it, rather than by its
  // old address — the address is exactly what just changed, and an owner may
  // have moved the page themselves in between.
  const owned = await pageOwnedBy(id, locale);
  if (!owned) return;
  await updatePage.call({ id: owned, slug: target }, SYSTEM);
}

/**
 * A deleted location leaves its page behind, unpublished.
 *
 * Deleting it would throw away whatever the owner wrote on it, and §4.10 has
 * a `hidden` status precisely so that closing a location is not a deletion.
 * Unpublished means the page stops being served and stops being in the
 * sitemap, and the words survive if the location comes back.
 */
export async function onLocationDeleted(payload: unknown): Promise<void> {
  const { id } = payload as { id: string; slug: string };
  const locale = await defaultLocale();
  const owned = await pageOwnedBy(id, locale);
  if (!owned) return;
  const { publishPage } = await import("./service");
  await publishPage.call({ id: owned, published: false }, SYSTEM);
}

/** The page whose nap block points at this location, if there is one. */
async function pageOwnedBy(locationId: string, locale: string): Promise<string | null> {
  const rows = await db()
    .select({ id: pages.id, blocks: pages.blocks })
    .from(pages)
    .where(eq(pages.locale, locale));
  for (const row of rows) {
    const blocks = row.blocks as BlockNode[];
    if (blocks.some((block) => block.type === "nap" && block.props.locationId === locationId)) {
      return row.id;
    }
  }
  return null;
}

/** The locale a generated page is written in — the site's own (§4.9). */
async function defaultLocale(): Promise<string> {
  const { getBusiness } = await import("@/core/settings/service");
  const business = await getBusiness.call({}, SYSTEM);
  return business?.defaultLocale ?? "en";
}
