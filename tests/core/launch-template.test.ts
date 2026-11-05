// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The launch template (MASTER.md §43 C3.35).
//
// A launch spec has to produce a site that works, not a waitlist: published
// server-rendered pages within the §5 doctrine, an offer page with its price,
// forms that put people on the contact spine, a bookable intro call, and
// status copy on every page that says what is not live yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { installLaunch, launchNav, launchPages, launchSpecSchema, type LaunchSpec } from "@/modules/seed/launch";
import { getSection, resolvePage } from "@/modules/cms/service";
import { getBusiness } from "@/core/settings/service";
import { submitForm } from "@/modules/forms/service";
import { HEADER_KEY } from "@/modules/cms/defaults";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { ANONYMOUS, OWNER, closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const EXAMPLE = JSON.parse(readFileSync(join(__dirname, "../../seed/launch/example.json"), "utf8")) as unknown;
const spec = (): LaunchSpec => launchSpecSchema.parse(EXAMPLE);

function walk(nodes: BlockNode[], visit: (node: BlockNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
  }
}

describe("the launch spec", () => {
  it("accepts the documented example", () => {
    expect(spec().offer.price).toBe("49.00");
  });

  it("requires honest status copy", () => {
    const { status: _status, ...rest } = EXAMPLE as Record<string, unknown>;
    expect(launchSpecSchema.safeParse(rest).success).toBe(false);
  });

  it("refuses an offer slug that is one of the site's own pages, and unknown fields", () => {
    const base = EXAMPLE as { offer: Record<string, unknown> };
    expect(launchSpecSchema.safeParse({ ...base, offer: { ...base.offer, slug: "contact" } }).success).toBe(false);
    expect(launchSpecSchema.safeParse({ ...base, extra: true }).success).toBe(false);
  });
});

describe("the pages a spec installs", () => {
  const pages = launchPages(spec());

  it("has exactly one H1 on each page and keeps every page one hop from the root", () => {
    for (const page of pages) {
      let h1 = 0;
      walk(page.blocks, (node) => {
        if (node.type === "heading" && (node.props as { level?: number }).level === 1) h1 += 1;
      });
      expect({ slug: page.slug, h1 }).toEqual({ slug: page.slug, h1: 1 });
      expect(page.slug.split("/").length).toBeLessThanOrEqual(1);
    }
  });

  it("gives every page a unique title and description within search-result lengths", () => {
    const titles = pages.map((p) => p.seo.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const page of pages) {
      expect(page.seo.title.length).toBeLessThanOrEqual(60);
      expect(page.seo.description.length).toBeGreaterThan(0);
      expect(page.seo.description.length).toBeLessThanOrEqual(160);
    }
  });

  it("links every page from the navigation", () => {
    const linked = new Set(launchNav(spec()).map((link) => link.href));
    for (const page of pages.filter((p) => p.slug)) expect(linked.has(`/${page.slug}`)).toBe(true);
  });

  it("states the price on the offer page and carries the request form", () => {
    const offer = pages.find((p) => p.slug === "summaries")!;
    const forms: string[] = [];
    walk(offer.blocks, (node) => {
      if (node.type === "form") forms.push(String((node.props as { formSlug: string }).formSlug));
    });
    expect(forms).toEqual(["offer-request"]);
    expect(JSON.stringify(offer.blocks)).toContain("$49 a month (planned)");
  });
});

describe.runIf(hasDatabase)("installing a launch spec", { timeout: 120_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("publishes a working one-offer site with status copy on every page", async () => {
    const result = await installLaunch.call(spec(), { kind: "system" });
    expect(result.pages).toEqual(["", "summaries", "about", "status", "contact", "intro-call"]);
    expect(result.forms.sort()).toEqual(["call-request", "contact", "offer-request"]);
    expect(result.callRequest).toBe(true);
    expect(result.brandApplied).toBe(true);

    const business = await getBusiness.call({}, ANONYMOUS);
    expect(business?.name).toBe("Harbour Notes");
    for (const slug of result.pages) {
      const page = await resolvePage.call({ slug }, ANONYMOUS);
      expect(page, slug).not.toBeNull();
    }
    const header = await getSection.call({ key: HEADER_KEY }, ANONYMOUS);
    expect(JSON.stringify(header)).toContain("payments are not connected yet");
  });

  it("puts an offer request on the contact spine", async () => {
    await installLaunch.call(spec(), { kind: "system" });
    const sent = await submitForm.call(
      { slug: "offer-request", values: { name: "Sam Rivera", email: "sam@example.com", message: "Weekly team meeting." } },
      ANONYMOUS,
    );
    expect(sent.ok).toBe(true);
  });

  it("refuses a site that already has pages", async () => {
    await installLaunch.call(spec(), { kind: "system" });
    const refused = await failure(installLaunch.call(spec(), OWNER));
    expect(refused.code).toBe("conflict");
  });
});

describe("launch spec version 2 (C3.39)", () => {
  const V2 = JSON.parse(readFileSync(join(__dirname, "../../seed/launch/example-v2.json"), "utf8")) as Record<string, unknown>;
  const v2 = (): LaunchSpec => launchSpecSchema.parse(V2);

  it("accepts the documented example and keeps version 1 strict", () => {
    expect(v2().intake?.fields.some((f) => f.kind === "file")).toBe(true);
    expect(launchSpecSchema.safeParse({ ...(EXAMPLE as object), intake: V2.intake }).success).toBe(false);
    const { payments: _payments, ...noPayments } = V2;
    expect(launchSpecSchema.safeParse(noPayments).success).toBe(false);
  });

  it("refuses a file question without what it accepts, and a choice without options", () => {
    const bad = (field: Record<string, unknown>) => launchSpecSchema.safeParse({ ...V2, intake: { ...(V2.intake as object), fields: [field] } }).success;
    expect(bad({ key: "f", label: "F", kind: "file" })).toBe(false);
    expect(bad({ key: "c", label: "C", kind: "select" })).toBe(false);
    expect(bad({ key: "email", label: "E", kind: "text" })).toBe(false);
  });

  it("adds /start with the onboarding form and the payment step, and My account in the nav", () => {
    const spec = v2();
    const start = launchPages(spec).find((page) => page.slug === "start")!;
    const text = JSON.stringify(start.blocks);
    expect(text).toContain("\"formSlug\":\"onboarding\"");
    expect(text).toContain("Test payments are not connected yet");
    expect(text).toContain("/portal/login");
    const nav = launchNav(spec).map((link) => link.href);
    expect(nav).toContain("/start");
    expect(nav).toContain("/portal");
    // The test-mode note is the payment step's, not every page's.
    for (const page of launchPages(spec).filter((p) => p.slug !== "start")) {
      expect(JSON.stringify(page.blocks)).not.toContain("Test payments are not connected yet");
    }
  });
});

describe.runIf(hasDatabase)("installing a version 2 spec", { timeout: 120_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  it("installs an onboarding intake with a file question", async () => {
    const V2 = JSON.parse(readFileSync(join(__dirname, "../../seed/launch/example-v2.json"), "utf8")) as unknown;
    const result = await installLaunch.call(launchSpecSchema.parse(V2), { kind: "system" });
    expect(result.pages).toContain("start");
    expect(result.forms).toContain("onboarding");
    expect(result.intakeForms).toContain("onboarding");
    const page = await resolvePage.call({ slug: "start" }, ANONYMOUS);
    expect(page).not.toBeNull();
  });
});
