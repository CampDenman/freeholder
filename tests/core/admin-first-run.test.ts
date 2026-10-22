// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a non-technical owner meets in their first five minutes (demo audit
// 2026-10-22): a first win they can see, plain words instead of internals,
// and pickers instead of codes typed from memory.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseFirstWin } from "@/core/guidance/first-win";
import type { GuidanceFlowView } from "@/core/guidance/service";
import { t, translator } from "@/core/i18n";
import { percentToPpm, ppmToPercent } from "../../app/(admin)/percent";
import { currencyOptions, localeOptions, timezoneOptions } from "@/ui/pickers";

function flow(
  key: string,
  overrides: Partial<GuidanceFlowView> = {},
): GuidanceFlowView {
  return {
    key,
    version: 1,
    titleKey: `${key}.title`,
    descriptionKey: `${key}.description`,
    audienceRoles: [],
    requiredCapabilities: [],
    audienceMatch: false,
    state: "not_started",
    completedCount: 0,
    totalCount: 2,
    startedAt: null,
    completedAt: null,
    steps: [],
    ...overrides,
  };
}

describe("choosing the first win", () => {
  it("does not lead a role-less owner with the bookkeeper's reporting routine", () => {
    // The playground's flows arrive sorted by key, bookkeeper first.
    const flows = [
      flow("core.bookkeeper-first-win"),
      flow("core.editor-first-win"),
      flow("core.service-provider-first-win"),
    ];
    expect(chooseFirstWin(flows)?.key).toBe("core.editor-first-win");
  });

  it("still prefers the curriculum written for the person's role", () => {
    const flows = [
      flow("core.editor-first-win"),
      flow("core.bookkeeper-first-win", { audienceMatch: true }),
    ];
    expect(chooseFirstWin(flows)?.key).toBe("core.bookkeeper-first-win");
  });

  it("moves past what the owner has already done or skipped", () => {
    const flows = [
      flow("core.editor-first-win", { state: "completed" }),
      flow("core.owner-first-win", { audienceMatch: true, state: "dismissed" }),
      flow("core.service-provider-first-win"),
    ];
    expect(chooseFirstWin(flows)?.key).toBe("core.service-provider-first-win");
  });

  it("keeps a started flow in front", () => {
    const flows = [
      flow("core.editor-first-win"),
      flow("core.bookkeeper-first-win", { state: "active" }),
    ];
    expect(chooseFirstWin(flows)?.key).toBe("core.bookkeeper-first-win");
  });

  it("returns nothing when there is nothing to show", () => {
    expect(chooseFirstWin([])).toBeUndefined();
  });

  it("is what the overview uses", () => {
    const page = readFileSync("app/(admin)/admin/page.tsx", "utf8");
    expect(page).toContain("chooseFirstWin(guidance)");
    expect(page).not.toContain("guidance[0]");
    expect(page).toContain('include: includeSystem ? "all" : "people"');
  });
});

describe("percent fields", () => {
  const en = translator("en");
  const fr = translator("fr");

  it("turns what an owner types into parts per million", () => {
    expect(percentToPpm("10", en)).toBe(100_000);
    expect(percentToPpm("12.5", en)).toBe(125_000);
    expect(percentToPpm("12,5", en)).toBe(125_000);
    expect(percentToPpm("15%", en)).toBe(150_000);
    expect(percentToPpm("100", en)).toBe(1_000_000);
    expect(ppmToPercent(125_000)).toBe("12.5");
  });

  it("reads Arabic-Indic digits as typed on an Arabic keyboard", () => {
    expect(percentToPpm("١٢٫٥", en)).toBe(125_000);
    expect(percentToPpm("۱۰٪", en)).toBe(100_000);
  });

  it("refuses nonsense and more than 100%, in the owner's language", () => {
    expect(() => percentToPpm("abc", en)).toThrow(en("admin.percent.invalid"));
    expect(() => percentToPpm("101", en)).toThrow(en("admin.percent.tooHigh"));
    expect(() => percentToPpm("", fr)).toThrow(fr("admin.percent.invalid"));
    expect(fr("admin.percent.invalid")).not.toBe(en("admin.percent.invalid"));
  });

  it("is how the coupon and deposit forms ask", () => {
    const page = readFileSync("app/(admin)/admin/promotions/page.tsx", "utf8");
    expect(page).toContain('name="percentOff"');
    expect(page).not.toContain('defaultValue="100000"');
    const product = readFileSync("app/(admin)/admin/products/[id]/page.tsx", "utf8");
    expect(product).toContain('name="depositPercent"');
    expect(product).not.toContain('name="depositPercentPpm"');
    expect(t("en", "catalog.offering.depositPercent")).not.toMatch(/ppm/i);
  });
});

describe("pickers instead of typed codes", () => {
  it("names currencies in the reader's language and keeps a stored code", () => {
    const options = currencyOptions("en", "CAD");
    expect(options.find((option) => option.value === "CAD")?.label).toBe(
      "CAD — Canadian Dollar",
    );
    expect(currencyOptions("en", "XQQ")[0]!.value).toBe("XQQ");
  });

  it("lists time zones readably and stores the IANA name", () => {
    const options = timezoneOptions();
    expect(options.find((option) => option.value === "America/Los_Angeles")?.label)
      .toBe("America/Los Angeles");
    expect(timezoneOptions("Mars/Olympus")[0]!.value).toBe("Mars/Olympus");
  });

  it("offers languages by name", () => {
    const options = localeOptions("en", "fr-CA");
    expect(options.find((option) => option.value === "fr-CA")?.label).toMatch(/French/);
  });

  it("replaces the free-text fields the audit found", () => {
    for (const file of [
      "app/(admin)/admin/invoices/new/page.tsx",
      "app/(admin)/admin/price-lists/page.tsx",
      "app/(admin)/admin/products/[id]/page.tsx",
      "app/(admin)/admin/events/[id]/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("currencyOptions(");
      expect(source, file).not.toMatch(/<Input id="[a-z-]*currency" name="currency"/);
    }
    const contact = readFileSync("app/(admin)/admin/contacts/ContactForm.tsx", "utf8");
    expect(contact).toContain("pickers.timezones");
    expect(contact).toContain("pickers.locales");
  });
});

describe("owner-facing copy", () => {
  const JARGON = [
    /\bchrome\b/i,
    /contact spine/i,
    /cart is a token/i,
    /\bRMA\b/,
    /deterministic/i,
    /parts per million/i,
    /wait on an adapter/i,
    /user: followed by/i,
    /\bIANA\b/,
  ];
  const keys = [
    "admin.nav.sections",
    "cms.sections.title",
    "cms.sectionKind.chrome",
    "cms.block.chromeBar",
    "catalog.carts.intro",
    "catalog.prices.listsIntro",
    "catalog.promo.percentPpm",
    "catalog.returns.intro",
    "catalog.shipping.intro",
    "cms.comments.mentionsHint",
    "contactImports.signup.committed",
    "contactImports.signup.emailRequired",
    "contacts.field.timezoneHint",
    "forms.intro",
  ];

  it.each(keys)("%s speaks plainly in English", (key) => {
    const text = t("en", key);
    for (const pattern of JARGON) expect(text).not.toMatch(pattern);
  });

  it("relabels the header and footer in every language, not only English", () => {
    for (const key of ["cms.block.chromeBar", "cms.sectionKind.chrome", "cms.sections.back", "translations.chrome"]) {
      expect(t("fr", key), key).toMatch(/en-tête/i);
      expect(t("es", key), key).toMatch(/encabezado/i);
      expect(t("ar", key), key).toMatch(/الترويس/);
    }
  });

  it("calls a URL slug a page link, not an address", () => {
    for (const key of ["events.slug", "catalog.slug", "newsletters.slug"]) {
      expect(t("en", key)).toBe("Page link");
    }
  });

  it("names modules instead of showing their keys", () => {
    for (const key of ["cms", "seed", "proof", "crm", "voice-video"]) {
      const name = t("en", `settings.modules.name.${key}`);
      expect(name).not.toBe(key);
      expect(name).not.toContain("settings.modules");
    }
    const page = readFileSync("app/(admin)/admin/settings/page.tsx", "utf8");
    expect(page).toContain("t(`settings.modules.name.${row.module}`)");
  });

  it("keeps form labels in the reading face, not monospace", () => {
    const primitives = readFileSync("src/ui/primitives.tsx", "utf8");
    const field = primitives.slice(primitives.indexOf("export function Field"));
    const label = field.slice(field.indexOf("<label"), field.indexOf("</label>"));
    expect(label).not.toContain("font-mono");
    // Stretched grid rows made a field beside a hinted one taller.
    expect(field).toContain('className="grid content-start gap-1.5"');
  });

  it("shows people by name in comments and history, never actor ids", () => {
    const comments = readFileSync("app/(admin)/admin/pages/[id]/PageComments.tsx", "utf8");
    expect(comments).not.toContain("{root.createdBy}");
    expect(comments).not.toContain("{reply.createdBy}");
    expect(comments).toContain('name="mentions"');
    const presence = readFileSync("app/(admin)/admin/pages/[id]/PagePresence.tsx", "utf8");
    expect(presence).not.toMatch(/\{row\.actor\}\s*$/m);
    for (const file of [
      "app/(admin)/admin/products/[id]/page.tsx",
      "app/(admin)/admin/inventory/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain("actorLabel(");
    }
  });

  it("keeps media integrity details behind a disclosure", () => {
    const media = readFileSync("app/(admin)/admin/media/page.tsx", "utf8");
    expect(media).toContain('t("media.details")');
    expect(media).toMatch(/asset\.scanStatus === "not_configured" \? null/);
  });
});
