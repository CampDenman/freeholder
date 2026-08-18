// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Installing the demo business (MASTER.md §3, §13, §15.2, §25).
//
// A service rather than a script, for the reason §11 gives: the admin, the
// REST API, MCP and CI all have to reach the same code, and a script would be
// a fifth way in that skips permission checks, the transaction and the audit
// row. Seeding writes an owner's business profile and their public pages —
// exactly the kind of thing that should be attributable.
//
// Everything it writes goes through the ordinary services, so the demo can
// only contain content an owner could have produced by hand. That is the point
// of the exercise: if the seed needs a table write the service layer forbids,
// the seed is wrong or the service layer is.
import { z } from "zod";
import sharp from "sharp";
import { count } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { pages } from "@/modules/cms/schema";
import { updateBusiness, completeSetup } from "@/core/settings/service";
import { uploadAsset } from "@/core/media/service";
import {
  createLocationService,
  setOpeningHours,
} from "@/core/locations/service";
import {
  createPage,
  ensureDefaults,
  listPages,
  publishPage,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import { FOOTER_KEY, HEADER_KEY } from "@/modules/cms/defaults";
import { createForm } from "@/modules/forms/service";
import { setTranslation } from "@/core/i18n/service";
import {
  BUSINESS,
  footer,
  FORMS,
  HOURS,
  LOCATION,
  header,
  IMAGES,
  PAGES,
  TRANSLATIONS,
  type ImageSlot,
} from "../../../seed/demo/content";

export const installDemo = defineService({
  name: "demo.install",
  summary: "Fill an empty instance with the Aurora Coast demo business.",
  kind: "mutation",
  // Owner rather than staff: this rewrites the business profile, which is the
  // instance's identity. `system` reaches it through ctx.callAsSystem at boot
  // when FREEHOLDER_SEED_DEMO is set.
  permission: "scoped",
  input: z.object({
    /** Publish the pages, rather than leaving them as drafts to look at. */
    publish: z.boolean().default(true),
  }),
  output: z.object({
    business: z.string(),
    pages: z.array(z.string()),
    assets: z.number().int(),
  }),
  handler: async (input, ctx) => {
    // Refusing on a populated instance is the whole safety story. There is no
    // force flag: an owner who wants the demo over their real site can delete
    // their pages first and mean it, and a missing flag cannot be passed by
    // accident from a deploy recipe's environment.
    const [populated] = await ctx.tx.select({ n: count() }).from(pages);
    if ((populated?.n ?? 0) > 0) {
      throw new ServiceError(
        "conflict",
        "This instance already has pages. The demo only installs into an empty site.",
      );
    }

    await ctx.callAsSystem(updateBusiness, BUSINESS);

    // Images first: the pages reference them by id, and a page written with a
    // dangling assetId would render a hole rather than fail loudly.
    const assets = {} as Record<ImageSlot, string>;
    for (const [slot, image] of Object.entries(IMAGES) as [
      ImageSlot,
      (typeof IMAGES)[ImageSlot],
    ][]) {
      // Encoded here rather than committed as binaries: a repository people
      // fork should not carry megabytes of stock photography, and sharp turns
      // the vector into a real JPEG the media pipeline treats like any upload.
      const jpeg = await sharp(Buffer.from(image.svg))
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const asset = await ctx.callAsSystem(uploadAsset, {
        filename: image.filename,
        contentType: "image/jpeg",
        bytes: new Uint8Array(jpeg),
        altText: image.alt,
      });
      assets[slot] = asset.id;
    }

    // Forms before pages, for the same reason images are: a form block names
    // a form by slug, and a page referring to one that does not exist yet
    // renders a hole rather than failing.
    for (const form of FORMS) {
      await ctx.callAsSystem(createForm, {
        slug: form.slug,
        name: form.name,
        submitLabel: form.submitLabel,
        successMessage: form.successMessage,
        fields: form.fields,
      });
    }

    // The location before the chrome that renders it: the footer's NAP block
    // resolves a location at render time, and seeding it afterwards would
    // leave the demo's first render with an empty footer.
    const location = await ctx.callAsSystem(createLocationService, {
      ...LOCATION,
      isPrimary: true,
    });
    await ctx.callAsSystem(setOpeningHours, {
      locationId: location.id,
      entries: HOURS,
    });

    // The same path an owner walks: finishing setup gives you a header, a
    // footer and a home page, and then you edit them. `ensureDefaults` is what
    // creates the two sections at all — `updateSection` updates, it does not
    // conjure — so the demo asks for the defaults rather than reaching past
    // the service layer to insert rows the platform owns.
    await ctx.callAsSystem(ensureDefaults, {});

    await ctx.callAsSystem(updateSection, {
      key: HEADER_KEY,
      name: "Header",
      blocks: header(),
    });
    await ctx.callAsSystem(updateSection, {
      key: FOOTER_KEY,
      name: "Footer",
      blocks: footer(),
    });

    // Which slugs already exist, which is just the home page the defaults left
    // behind. Everything else is new.
    const existing = new Map(
      (await ctx.callAsSystem(listPages, {})).map((page) => [page.slug, page.id]),
    );

    const created: string[] = [];
    for (const page of PAGES) {
      const priorId = existing.get(page.slug);
      const row = priorId
        ? await ctx.callAsSystem(updatePage, {
            id: priorId,
            title: page.title,
            blocks: page.blocks(assets),
            seo: page.seo,
          })
        : await ctx.callAsSystem(createPage, {
            slug: page.slug,
            title: page.title,
            blocks: page.blocks(assets),
            seo: page.seo,
          });
      if (input.publish) {
        await ctx.callAsSystem(publishPage, { id: row.id, published: true });
      }
      created.push(page.slug);
    }

    // Translations last: they name a page by id, so the pages have to exist.
    const bySlug = new Map(
      (await ctx.callAsSystem(listPages, {})).map((page) => [page.slug, page.id]),
    );
    for (const translation of TRANSLATIONS) {
      const pageId = bySlug.get(translation.slug);
      if (!pageId) continue;
      await ctx.callAsSystem(setTranslation, {
        entityType: "page",
        entityId: pageId,
        locale: translation.locale,
        status: "reviewed",
        fields: {
          title: translation.title,
          seo: translation.seo,
          blocks: translation.blocks(assets),
        },
      });
    }

    await ctx.callAsSystem(completeSetup, {});

    ctx.queueEvent("demo.installed", { pages: created.length });
    return {
      business: BUSINESS.name,
      pages: created,
      assets: Object.keys(assets).length,
    };
  },
});

export default [installDemo];
