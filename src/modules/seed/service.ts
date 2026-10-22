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
import { defineOrchestratedService, defineService, ServiceError } from "@/core/service";
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
import { FOOTER_KEY, HEADER_KEY, NAV_KEY } from "@/modules/cms/defaults";
import { createForm } from "@/modules/forms/service";
import { setTranslation } from "@/core/i18n/service";
import * as demo from "../../../seed/demo/content";
import { installPreset } from "./preset-install";
import { installDemoBusiness } from "./business";
import { installBusyDemo } from "./busy";

export { installPreset, installBusyDemo };

const installDemoGuard = defineService({
  name: "demo.installGuard",
  summary: "Refuse to seed a site that already has pages.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  handler: async (_input, ctx) => {
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
    return { ok: true as const };
  },
});

const installDemoApply = defineService({
  name: "demo.installApply",
  summary: "Write the demo business, pages and translations after images are stored.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    publish: z.boolean(),
    assets: z.record(z.string(), z.string().uuid()),
  }),
  output: z.object({
    business: z.string(),
    pages: z.array(z.string()),
    assets: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const pack = demo;
    const { BUSINESS, LOCATION, HOURS, FORMS, PAGES, TRANSLATIONS, header, nav, footer } =
      pack;
    const assets = input.assets;

    await ctx.callAsSystem(updateBusiness, BUSINESS);

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
    // The menu goes in the Navigation section, the one place chrome reads a
    // site's menu from (C2.11). Seeding it into the header instead is what
    // left the demo's menu reading just "Locations": ensureDefaults moves a
    // header menu out, and the nav section already had the platform's
    // /locations link.
    await ctx.callAsSystem(updateSection, {
      key: NAV_KEY,
      name: "Navigation",
      blocks: nav(),
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
            blocks: page.blocks(assets as never),
            seo: page.seo,
          })
        : await ctx.callAsSystem(createPage, {
            slug: page.slug,
            title: page.title,
            blocks: page.blocks(assets as never),
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
          blocks: translation.blocks(assets as never),
        },
      });
    }

    // The planning page's calculators (C5.26). Facts first: publishing a
    // calculator is refused while any figure it names is unpublished, so the
    // seed walks the same path an owner does — record the figures, then open
    // the calculators.
    const { recordFact } = await import("@/core/attestations/service");
    const { createCalculator, publishCalculator } = await import(
      "@/modules/calculators/service"
    );
    for (const fact of pack.FACTS) {
      await ctx.callAsSystem(recordFact, {
        key: fact.key,
        value: fact.value,
        source: fact.source,
        asOf: new Date(`${fact.asOf}T00:00:00.000Z`),
        validUntil: fact.validUntil
          ? new Date(`${fact.validUntil}T00:00:00.000Z`)
          : undefined,
      });
    }
    for (const configured of pack.CALCULATORS) {
      const made = await ctx.callAsSystem(createCalculator, configured);
      await ctx.callAsSystem(publishCalculator, { id: made.id });
    }

    // The shop, the bookable services, the events and the share settings —
    // the parts of the business a visitor can buy, book and attend (C1.38).
    await installDemoBusiness(ctx, { assets, locationId: location.id });

    // After the pages, so the demo's own /newsletters page is the archive
    // (ensureIndex will not replace it) and publishing the issue only adds
    // the leaf. The template is campaign wording, not a page.
    const { createNewsletter, createIssue, publishIssue, saveTemplate } = await import(
      "@/modules/newsletters/service"
    );
    const letter = pack.NEWSLETTER;
    const newsletter = await ctx.callAsSystem(createNewsletter, {
      name: letter.name,
      slug: letter.slug,
      description: letter.description,
    });
    const issue = await ctx.callAsSystem(createIssue, {
      newsletterId: newsletter.id,
      slug: letter.issue.slug,
      title: letter.issue.title,
      excerpt: letter.issue.excerpt,
      body: letter.issue.body,
    });
    await ctx.callAsSystem(publishIssue, { id: issue.id, expectedVersion: issue.version });
    await ctx.callAsSystem(saveTemplate, {
      kind: "campaign",
      name: letter.template.name,
      subject: letter.template.subject,
      blocks: [{ type: "text", props: { body: letter.template.body } }],
      variables: ["contact.first_name"],
      status: "active",
    });

    await ctx.callAsSystem(completeSetup, {});

    ctx.queueEvent("demo.installed", { pages: created.length });
    return {
      business: BUSINESS.name,
      pages: created,
      assets: Object.keys(assets).length,
    };
  },
});

export const installDemo = defineOrchestratedService({
  name: "demo.install",
  summary: "Fill an empty instance with the Aurora Coast Photography demo.",
  kind: "mutation",
  // Owner rather than staff: this rewrites the business profile, which is the
  // instance's identity. `system` reaches it through ctx.callAsSystem at boot
  // when FREEHOLDER_SEED_DEMO is set.
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    /** Publish the pages, rather than leaving them as drafts to look at. */
    publish: z.boolean().default(true),
  }),
  output: z.object({
    business: z.string(),
    pages: z.array(z.string()),
    assets: z.number().int(),
  }),
  handler: async (input, actor) => {
    await installDemoGuard.call({}, actor);
    const { IMAGES } = demo;
    const assets = {} as Record<string, string>;
    for (const [slot, image] of Object.entries(IMAGES)) {
      // Encoded here rather than committed as binaries: a repository people
      // fork should not carry megabytes of stock photography, and sharp turns
      // the illustration into a real JPEG the media pipeline treats like any
      // upload.
      const jpeg = await sharp(Buffer.from(image.svg))
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const asset = await uploadAsset.call(
        {
          filename: image.filename,
          contentType: "image/jpeg",
          bytes: new Uint8Array(jpeg),
          altText: image.alt,
        },
        { kind: "system" },
      );
      assets[slot] = asset.id;
    }
    return installDemoApply.call({ publish: input.publish, assets }, actor);
  },
});

export default [installDemo, installDemoGuard, installDemoApply, installPreset, installBusyDemo];
