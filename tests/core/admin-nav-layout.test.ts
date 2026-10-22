// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The admin shell a first-time owner meets (demo audit 2026-10-22): grouped
// navigation that collapses on a phone, a title per screen, and a demo
// banner that neither steals the first tab stop nor leaks into the preview.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV_ENTRIES,
  ADMIN_NAV_GROUPS,
  isActiveAdminHref,
  type AdminNavLabels,
} from "../../app/(admin)/admin/AdminNav";
import { adminScreenLabel } from "../../app/(admin)/admin/adminTitle";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("admin navigation grouping", () => {
  it("files every nav entry under exactly one group", () => {
    const grouped = ADMIN_NAV_GROUPS.flatMap((group) => group.links);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(
      ADMIN_NAV_ENTRIES.map((entry) => entry.key).sort(),
    );
  });

  it("keeps the groups few enough to scan", () => {
    expect(ADMIN_NAV_GROUPS.length).toBeLessThanOrEqual(8);
    expect(ADMIN_NAV_GROUPS[0]!.links).toContain("overview");
  });

  it("matches whole path segments, so one screen is current at a time", () => {
    expect(isActiveAdminHref("/admin/calendar", "/admin/calendars")).toBe(false);
    expect(isActiveAdminHref("/admin/calendars", "/admin/calendars")).toBe(true);
    expect(isActiveAdminHref("/admin/products", "/admin/products/42")).toBe(true);
    expect(isActiveAdminHref("/admin", "/admin/products")).toBe(false);
  });

  it("collapses behind a script-free toggle below the desktop breakpoint, with one copy of the links", () => {
    // A checkbox toggle, not a script-driven button: the phone menu must
    // open even before (or without) JavaScript. And one list, not a phone
    // copy plus a desktop copy: duplicated links made every "find the
    // invitations link" ambiguous.
    const nav = read("app/(admin)/admin/AdminNav.tsx");
    expect(nav).toMatch(/<input\s+id="admin-nav-toggle"\s+type="checkbox"/);
    expect(nav).toContain('htmlFor="admin-nav-toggle"');
    expect(nav).toMatch(/id="admin-nav-groups" className="hidden [^"]*peer-checked:block lg:block/);
    expect(nav.match(/\{groups\}/g)).toHaveLength(1);
    expect(nav).not.toContain("useState");
    expect(nav).not.toContain("overflow-y-auto");
    expect(nav).toContain('event.key !== "Escape"');
    const layout = read("app/(admin)/admin/layout.tsx");
    expect(layout).toContain("lg:grid-cols-[14rem_minmax(0,1fr)]");
  });
});

describe("admin document titles", () => {
  const labels = Object.fromEntries(
    ADMIN_NAV_ENTRIES.map((entry) => [entry.key, `label:${entry.key}`]),
  ) as unknown as AdminNavLabels;
  labels.region = "Admin sections";

  it("names each screen after its nav entry", () => {
    for (const entry of ADMIN_NAV_ENTRIES) {
      expect(adminScreenLabel(entry.href, labels), entry.href).toBe(`label:${entry.key}`);
      if (entry.href !== "/admin") {
        expect(adminScreenLabel(`${entry.href}/some-id`, labels)).toBe(`label:${entry.key}`);
      }
    }
  });

  it("never answers with the nav's own landmark name or a prototype key", () => {
    expect(adminScreenLabel("/admin/region", labels)).toBeNull();
    expect(adminScreenLabel("/admin/constructor", labels)).toBeNull();
    expect(adminScreenLabel("/portal", labels)).toBeNull();
  });

  it("is used by the admin layout instead of one title for every screen", () => {
    const layout = read("app/(admin)/admin/layout.tsx");
    expect(layout).toContain("adminScreenLabel(");
    expect(layout).not.toMatch(/title: `\$\{t\("admin\.nav\.label"\)\}/);
  });
});

describe("document shell", () => {
  const root = read("app/layout.tsx");

  it("writes the demo banner after the page so the skip link is the first tab stop", () => {
    const children = root.indexOf('<div className="flex-1">{children}</div>');
    const banner = root.indexOf('<aside className="order-first');
    expect(children).toBeGreaterThan(-1);
    expect(banner).toBeGreaterThan(children);
  });

  it("offers the public site inside the admin and keeps the banner out of previews", () => {
    expect(root).toContain('t("playground.viewSite")');
    expect(root).toMatch(/showPlaygroundBanner = playground && !\/\^\\\/preview/);
  });

  it("gives every route, including a 404, a non-empty fallback title", () => {
    expect(root).toContain("export async function generateMetadata");
    const catchAll = read("app/(public)/[[...slug]]/page.tsx");
    expect(catchAll).toContain('composeDocumentTitle(t("notFound.title")');
    expect(catchAll).not.toContain("if (!page) return {};");
    expect(read("app/portal/login/page.tsx")).toContain('t("portal.login.title")');
  });

  it("keeps notification channels a valid definition list (axe dlitem)", () => {
    const page = read("app/(admin)/admin/notifications/page.tsx");
    const list = page.slice(page.indexOf("<dl"), page.indexOf("</dl>"));
    // Each group is a <div> whose children are only <dt>/<dd>; a wrapper
    // <div> inside a group is what made axe fail.
    expect(list).not.toMatch(/<div[^>]*>\s*<div className="flex/);
  });

  it("does not float the privacy control over form fields on a phone", () => {
    const control = read("app/(public)/AnalyticsConsentControl.tsx");
    expect(control).toMatch(/<details className="[^"]*\bsm:fixed\b/);
    expect(control).not.toMatch(/<details className="fixed /);
  });
});
