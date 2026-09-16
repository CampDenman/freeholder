// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BENCH_TOKENS,
  cmsPageSlug,
  designExtras,
  emailTemplateKey,
  listPresets,
  preset,
} from "../../packages/templates/src/presets";
import { getDesign } from "@/core/design/service";
import { listProducts } from "@/modules/catalog/service";
import { getTemplate, listPages } from "@/modules/cms/service";
import { seedTemplates } from "@/modules/cms/templates";
import { installPreset } from "@/modules/seed/preset-install";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("@freeholder/templates business presets (C3.15)", () => {
  it("ships Bench tokens and full page, entity and email trees", () => {
    expect(BENCH_TOKENS.paper).toMatch(/^#/);
    expect(BENCH_TOKENS.ink).toMatch(/^#/);
    expect(BENCH_TOKENS.accent).toMatch(/^#/);
    expect(designExtras(BENCH_TOKENS)).toEqual({ radius: "0.375rem", measure: "56rem" });
    for (const key of listPresets()) {
      const value = preset(key);
      expect(value.pages.length).toBe(value.seed.pages);
      expect(value.pages.every((page) => page.blocks.some((block) => block.type === "heading"))).toBe(
        true,
      );
      expect(value.entities.length).toBeGreaterThan(0);
      expect(value.entities.every((entity) => entity.description.length > 0)).toBe(true);
      expect(value.emails.length).toBeGreaterThan(0);
      expect(value.emails.every((email) => email.blocks.length > 0 && email.variables.length > 0)).toBe(
        true,
      );
      expect(value.tokens.ink).toBe(BENCH_TOKENS.ink);
      expect(value.social.href).toBe("/admin/social");
      expect(value.social.autoAuthorize).toBe(false);
      expect(value.social.autoPublish).toBe(false);
      expect(cmsPageSlug("home")).toBe("");
      expect(value.pages.some((page) => page.blocks.some((block) => block.type === "form"))).toBe(
        true,
      );
    }
    expect(preset("creator").emails[0]?.key).toBe("welcome");
    expect(preset("service-business").emails[0]?.key).toBe("booking-confirm");
    expect(preset("shop").emails[0]?.key).toBe("order-receipt");
    expect(preset("shop").pages.some((page) => page.blocks.some((block) => block.type === "productsIndex"))).toBe(
      true,
    );
  });

  it("feeds CMS seed trees so emails install through template services", () => {
    expect(seedTemplates("creator").some((row) => row.key === "email.welcome")).toBe(true);
    expect(seedTemplates("service-business").some((row) => row.key === "email.booking-confirm")).toBe(
      true,
    );
    expect(seedTemplates("shop").some((row) => row.key === "email.order-receipt")).toBe(true);
  });
});

describe.runIf(hasDatabase)("seed.installPreset (C3.15)", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  async function business() {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
      },
      OWNER,
    );
  }

  it("installs creator pages, a product, the welcome email and Bench tokens", async () => {
    await business();
    const result = await installPreset.call({ preset: "creator" }, OWNER);
    expect(result.pages).toEqual(expect.arrayContaining(["", "about", "contact"]));
    expect(result.entities).toEqual(["featured-work"]);
    expect(result.emails).toEqual(["email.welcome"]);

    const pages = await listPages.call({}, OWNER);
    expect(pages.map((page) => page.slug).sort()).toEqual(["", "about", "contact", "featured-work-page"].sort());
    expect(
      (pages.find((page) => page.slug === "")?.blocks as { type: string }[]).some(
        (block) => block.type === "heading",
      ),
    ).toBe(true);
    expect(
      (pages.find((page) => page.slug === "contact")?.blocks as { type: string }[]).some(
        (block) => block.type === "form",
      ),
    ).toBe(true);

    const products = await listProducts.call({}, OWNER);
    expect(products.some((product) => product.slug === "featured-work" && product.kind === "digital")).toBe(
      true,
    );

    const welcome = await getTemplate.call({ key: emailTemplateKey("welcome"), preset: "creator" }, OWNER);
    expect(welcome?.kind).toBe("email");
    expect(welcome?.variables).toEqual(expect.arrayContaining(["contact.first_name", "business.name"]));
    expect((welcome?.blocks as { type: string }[]).some((block) => block.type === "heading")).toBe(true);

    const design = await getDesign.call({}, OWNER);
    expect(design.theme.light.paper).toBe(BENCH_TOKENS.paper);
    expect(design.theme.light.ink).toBe(BENCH_TOKENS.ink);
    expect(design.extras.measure).toBe("36rem");
  });

  it("installs a service offering and booking-confirm email for the service preset", async () => {
    await business();
    const result = await installPreset.call({ preset: "service-business" }, OWNER);
    expect(result.pages).toEqual(expect.arrayContaining(["", "services", "about", "contact"]));
    const products = await listProducts.call({ kind: "service" }, OWNER);
    expect(products.some((product) => product.slug === "session")).toBe(true);
    const email = await getTemplate.call(
      { key: "email.booking-confirm", preset: "service-business" },
      OWNER,
    );
    expect(email?.variables).toEqual(expect.arrayContaining(["booking.starts_at_local"]));
  });

  it("installs a shop product, products index and order-receipt email", async () => {
    await business();
    const result = await installPreset.call({ preset: "shop" }, OWNER);
    expect(result.entities).toEqual(["featured-product"]);
    const home = (await listPages.call({}, OWNER)).find((page) => page.slug === "");
    expect((home?.blocks as { type: string }[]).some((block) => block.type === "productsIndex")).toBe(
      true,
    );
    const email = await getTemplate.call({ key: "email.order-receipt", preset: "shop" }, OWNER);
    expect(email?.variables).toEqual(expect.arrayContaining(["invoice.total"]));
  });

  it("refuses an unknown preset", async () => {
    const error = await failure(
      installPreset.call({ preset: "not-a-preset" as "creator" }, OWNER),
    );
    expect(error.code).toBe("validation");
  });
});
