// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo's shop, bookable services, events and share settings (C1.38).
//
// Same rule as the rest of the demo installer: everything goes through the
// ordinary services, inside the caller's transaction, so the demo can only
// contain what an owner could have set up by hand. That rule is the reason
// this file exists — the old demo seeded a shop with nothing in it, because
// the path to a sellable product (a tax setup, a category, variants, a price
// list, stock) was never walked end to end. Walking it here keeps it walkable.
import type { ServiceContext } from "@/core/service";
import { installTaxTemplate, setTaxRegistration } from "@/modules/invoicing/tax-service";
import {
  activateProduct,
  createProduct,
  listProductTaxCategories,
} from "@/modules/catalog/service";
import {
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  createOptionType,
  getProductVariants,
  setProductOptionValues,
} from "@/modules/catalog/variants";
import { createPriceList, setPriceListEntry } from "@/modules/catalog/pricing";
import { adjustStock, enableInventory } from "@/modules/catalog/inventory";
import { addCollectionProduct, createCollection } from "@/modules/catalog/collections";
import { attachProductMedia } from "@/modules/catalog/merchandising";
import { setPriceRule, upsertServiceOffering } from "@/modules/catalog/offerings";
import { createCalendar, setServiceCalendars } from "@/core/scheduling/service";
import { setAvailability } from "@/core/scheduling/availability-service";
import {
  addEventSession,
  addEventTicket,
  createEvent,
  publishEvent,
} from "@/modules/events/service";
import { saveTarget } from "@/modules/share/service";
import { bookingAudienceServices, bookingAudiences } from "@/core/scheduling/audience-schema";
import { updateTemplate } from "@/modules/cms/template-service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import * as demo from "../../../seed/demo/content";

const DAY = 86_400_000;

function describe(text: string, prefix: string): BlockNode[] {
  return text.split("\n\n").map((body, index) => ({
    id: `${prefix}-p${index}`,
    type: "text",
    props: { body, align: "start", measure: true },
  }));
}

/** A date `days` from now at `hour` o'clock studio time (Pacific, UTC−7/8). */
function studioTime(days: number, hour: number): Date {
  const date = new Date(Date.now() + days * DAY);
  date.setUTCHours(hour + 7, 0, 0, 0);
  return date;
}

export async function installDemoBusiness(
  ctx: ServiceContext,
  input: { assets: Record<string, string>; locationId: string },
): Promise<{ products: number; services: number; events: number }> {
  const { CATALOG, COLLECTIONS, SERVICES, STUDIO_AVAILABILITY, EVENTS, SHARE_OFF, BUSINESS } = demo;

  // Tax first: activation refuses a product without an active tax category,
  // and the category comes with the province's starter. Collection is turned
  // on so checkout shows GST and PST the way a registered BC studio charges.
  const tax = await ctx.callAsSystem(installTaxTemplate, { key: "ca-bc" });
  if (tax.registration) {
    await ctx.callAsSystem(setTaxRegistration, {
      id: tax.registration.id,
      zoneId: tax.zone.id,
      number: "123456789RT0001",
      status: "active",
      acknowledgeTemplateLimitations: true,
    });
  }
  const categories = await ctx.callAsSystem(listProductTaxCategories, {});
  const standard = categories.find((category) => category.code === "standard");
  if (!standard) throw new Error("The BC tax starter did not leave a standard category.");

  // The product and service page templates, edited the way an owner would
  // before publishing a shop: the starter templates carry placeholder copy
  // ("Describe what they get…") that would otherwise sit on every live
  // product page. The product block brings the picture, description and
  // buy panel; the template only adds the heading and, for services, the
  // way to book.
  await ctx.callAsSystem(updateTemplate, {
    key: "product.default",
    blocks: [{ id: "demo-product-h1", type: "heading", props: { text: "Product", level: 1, align: "start" } }],
  });
  await ctx.callAsSystem(updateTemplate, {
    key: "service.default",
    blocks: [
      { id: "demo-service-h1", type: "heading", props: { text: "Service", level: 1, align: "start" } },
      { id: "demo-service-book", type: "button", props: { label: "Choose a time", href: "/book", variant: "solid" } },
    ],
  });

  const retail = await ctx.callAsSystem(createPriceList, {
    name: "CAD retail",
    currency: BUSINESS.baseCurrency,
    kind: "retail",
  });

  const sizeType = await ctx.callAsSystem(createOptionType, { name: "Print size", code: "print-size" });
  const sizeValues = new Map<string, string>();
  for (const [position, size] of demo.PRINT_SIZES.entries()) {
    const value = await ctx.callAsSystem(addOptionValue, {
      optionTypeId: sizeType.id,
      name: size.name,
      skuFragment: size.fragment,
      position,
    });
    sizeValues.set(size.fragment, value.id);
  }

  const collections = new Map<string, string>();
  for (const collection of COLLECTIONS) {
    const made = await ctx.callAsSystem(createCollection, {
      title: collection.title,
      slug: collection.slug,
      description: collection.description,
      seo: { description: collection.description },
      published: true,
    });
    collections.set(collection.slug, made.id);
  }

  for (const item of CATALOG) {
    let product = await ctx.callAsSystem(createProduct, {
      name: item.name,
      slug: item.slug,
      kind: item.kind,
      subtitle: item.subtitle,
      taxCategoryId: standard.id,
      description: describe(item.description, item.slug),
      seo: { description: `${item.name} — ${item.subtitle}.`.slice(0, 155) },
    });
    if (item.sizes) {
      product = await ctx.callAsSystem(assignProductOption, {
        productId: product.id,
        expectedVersion: product.version,
        optionTypeId: sizeType.id,
      });
      product = await ctx.callAsSystem(setProductOptionValues, {
        productId: product.id,
        expectedVersion: product.version,
        optionTypeId: sizeType.id,
        optionValueIds: item.sizes.map((size) => sizeValues.get(size.fragment)!),
      });
    }
    product = await ctx.callAsSystem(applyVariantMatrix, {
      productId: product.id,
      expectedVersion: product.version,
    });
    const { variants } = await ctx.callAsSystem(getProductVariants, { productId: product.id });
    for (const variant of variants) {
      const size = item.sizes?.find((entry) =>
        variant.options.some((option) => option.optionValueId === sizeValues.get(entry.fragment)),
      );
      await ctx.callAsSystem(setPriceListEntry, {
        priceListId: retail.id,
        variantId: variant.id,
        amount: size?.price ?? item.price!,
      });
      const stock = size?.stock ?? item.stock;
      if (item.kind === "physical" && stock) {
        const tracked = await ctx.callAsSystem(enableInventory, {
          variantId: variant.id,
          locationId: input.locationId,
        });
        await ctx.callAsSystem(adjustStock, {
          itemId: tracked.id,
          delta: stock,
          note: "Opening stock from the studio print run.",
        });
      }
    }
    const asset = input.assets[item.image];
    if (asset) {
      product = await ctx.callAsSystem(attachProductMedia, {
        productId: product.id,
        expectedVersion: product.version,
        assetId: asset,
        role: "hero",
      });
    }
    await ctx.callAsSystem(activateProduct, { id: product.id, expectedVersion: product.version });
    for (const slug of item.collections) {
      await ctx.callAsSystem(addCollectionProduct, {
        collectionId: collections.get(slug)!,
        productId: product.id,
      });
    }
  }

  // Services: a product, an offering, a way to pay, and the studio calendar
  // with weekly hours — the four things /book needs before it can offer a time.
  const calendar = await ctx.callAsSystem(createCalendar, {
    kind: "business",
    name: "Studio sessions",
    slug: "studio-sessions",
    timezone: BUSINESS.timezone,
    locationId: input.locationId,
    capacityDefault: 1,
    bookingHorizonDays: 90,
    minNoticeMin: 120,
  });
  await ctx.callAsSystem(setAvailability, {
    calendarId: calendar.id,
    rules: STUDIO_AVAILABILITY.map((rule) => ({ ...rule, kind: "bookable" as const })),
  });
  const offeringIds: string[] = [];
  for (const service of SERVICES) {
    const product = await ctx.callAsSystem(createProduct, {
      name: service.name,
      slug: service.slug,
      kind: "service",
      subtitle: service.subtitle,
      taxCategoryId: standard.id,
      description: describe(service.subtitle, service.slug),
      seo: { description: `${service.name}: ${service.subtitle.toLowerCase()}.`.slice(0, 155) },
    });
    const withVariant = await ctx.callAsSystem(applyVariantMatrix, {
      productId: product.id,
      expectedVersion: product.version,
    });
    const { variants } = await ctx.callAsSystem(getProductVariants, { productId: product.id });
    for (const variant of variants) {
      await ctx.callAsSystem(setPriceListEntry, {
        priceListId: retail.id,
        variantId: variant.id,
        amount: service.price,
      });
    }
    const offering = await ctx.callAsSystem(upsertServiceOffering, {
      productId: product.id,
      durationMin: service.durationMin,
      bufferAfterMin: service.bufferAfterMin,
      locationType: "in_person",
      currency: BUSINESS.baseCurrency,
    });
    offeringIds.push(offering.id);
    await ctx.callAsSystem(setPriceRule, { productId: product.id, mode: "full" });
    await ctx.callAsSystem(setServiceCalendars, {
      serviceOfferingId: offering.id,
      members: [{ calendarId: calendar.id, role: "primary" }],
    });
    await ctx.callAsSystem(activateProduct, {
      id: product.id,
      expectedVersion: withVariant.version,
    });
  }

  // Who may book (§41): everyone, these three services, on the calendar's
  // own hours. Without an audience /book answers "no times" for every date —
  // bookability belongs to the audience, not the calendar. Written as the
  // two rows `audiences.create` + `audiences.setServices` write, because
  // those refuse any actor but a signed-in person (the seed has none).
  const [everyone] = await ctx.tx
    .insert(bookingAudiences)
    .values({ name: "Everyone", slug: "everyone", who: "public", hours: "calendar" })
    .returning({ id: bookingAudiences.id });
  await ctx.tx
    .insert(bookingAudienceServices)
    .values(offeringIds.map((serviceOfferingId) => ({ audienceId: everyone!.id, serviceOfferingId })));

  for (const entry of EVENTS) {
    const event = await ctx.callAsSystem(createEvent, {
      name: entry.name,
      slug: entry.slug,
      summary: entry.summary,
      venueName: "Aurora Coast studio",
      venueLocationId: input.locationId,
    });
    const startsAt = studioTime(entry.daysAhead, entry.startHour);
    await ctx.callAsSystem(addEventSession, {
      eventId: event.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + entry.hours * 3_600_000),
      timezone: BUSINESS.timezone,
      capacity: entry.capacity,
    });
    await ctx.callAsSystem(addEventTicket, {
      eventId: event.id,
      name: entry.ticket.name,
      priceMinor: entry.ticket.priceMinor,
      currency: BUSINESS.baseCurrency,
    });
    await ctx.callAsSystem(publishEvent, { id: event.id, expectedVersion: event.version });
  }

  for (const path of SHARE_OFF) {
    await ctx.callAsSystem(saveTarget, {
      path: `/${path}`,
      locale: BUSINESS.defaultLocale,
      shareable: false,
    });
  }

  return { products: CATALOG.length, services: SERVICES.length, events: EVENTS.length };
}
