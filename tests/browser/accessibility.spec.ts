// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Chromium accessibility acceptance coverage for MASTER.md §43 C1.21.
// Static HTML helpers remain useful unit checks, but only a browser can prove
// layout reflow, keyboard focus, media preferences and the accessibility tree.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { THEME_COOKIE } from "@/core/design/theme";
import { pages } from "@/modules/cms/schema";
import { registerBlock } from "@/modules/cms/blocks/registry";
import { formBlock } from "@/modules/forms/block";
import { installDemo } from "@/modules/seed/service";
import {
  closeDb,
  CUSTOMER,
  OWNER,
} from "../helpers/spine";
import { resetBrowserDatabase } from "./database";

type Surface = "setup" | "admin" | "editor" | "storefront" | "portal";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";
const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

function axeSummary(
  nodes: Array<{ id: string; help: string; nodes: Array<{ target: unknown }> }>,
): string {
  return nodes
    .map(
      (rule) =>
        `${rule.id}: ${rule.help} (${rule.nodes
          .map((node) => JSON.stringify(node.target))
          .join(", ")})`,
    )
    .join("\n");
}

async function assertAxe(page: Page, surface: Surface, theme: "light" | "dark") {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  // Chromium/axe on Linux can report content inside a positioned iframe as
  // overlapped by the iframe itself, which turns a real colour pair into an
  // indeterminate 0:1 result. Audit the titled frame as a frame in the parent
  // tree, and its rendered canvas independently below so contrast is still a
  // browser-computed requirement rather than an excluded node.
  if (surface === "editor") builder.exclude("iframe");
  const results = await builder.analyze();
  expect(
    results.violations,
    `${surface} (${theme}) has WCAG A/AA violations:\n${axeSummary(results.violations)}`,
  ).toEqual([]);

  const unresolvedContrast = results.incomplete.filter(
    (result) => result.id === "color-contrast",
  );
  expect(
    unresolvedContrast,
    `${surface} (${theme}) has contrast that Chromium/axe could not determine:\n${axeSummary(unresolvedContrast)}`,
  ).toEqual([]);

  if (surface === "editor") {
    const previewUrl = await page.getByTitle("Preview").getAttribute("src");
    if (!previewUrl) throw new Error("The editor preview has no source URL.");
    const preview = await page.context().newPage();
    try {
      await preview.goto(previewUrl, { waitUntil: "domcontentloaded" });
      const previewResults = await new AxeBuilder({ page: preview })
        .include(".fh-canvas")
        .withTags(WCAG_TAGS)
        .analyze();
      expect(
        previewResults.violations,
        `editor preview (${theme}) has WCAG A/AA violations:\n${axeSummary(previewResults.violations)}`,
      ).toEqual([]);
      const previewContrast = previewResults.incomplete.filter(
        (result) => result.id === "color-contrast",
      );
      expect(
        previewContrast,
        `editor preview (${theme}) has indeterminate contrast:\n${axeSummary(previewContrast)}`,
      ).toEqual([]);
    } finally {
      await preview.close();
    }
  }
}

async function assertKeyboardAndFocus(page: Page, surface: Surface) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(page.url().split("#", 1)[0]!, { waitUntil: "domcontentloaded" });

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip, `${surface} must make its bypass link the first keyboard stop`).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.goto(page.url().split("#", 1)[0]!, { waitUntil: "domcontentloaded" });
  let checked = 0;
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) return null;
      const style = getComputedStyle(active);
      const rect = active.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(innerHeight, rect.bottom);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const topmost = right > left && bottom > top ? document.elementFromPoint(x, y) : null;
      return {
        name:
          active.getAttribute("aria-label") ??
          active.getAttribute("name") ??
          active.textContent?.trim().slice(0, 80) ??
          active.tagName,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        inViewport:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight,
        unobscured:
          topmost === null || active === topmost || active.contains(topmost) || topmost.contains(active),
      };
    });
    if (!focus) break;
    expect(focus.inViewport, `${surface}: focused "${focus.name}" is outside the viewport`).toBe(true);
    expect(focus.unobscured, `${surface}: focused "${focus.name}" is obscured`).toBe(true);
    expect(focus.outlineStyle, `${surface}: focused "${focus.name}" has no visible outline`).not.toBe("none");
    expect(focus.outlineWidth, `${surface}: focused "${focus.name}" has a sub-2px outline`).toBeGreaterThanOrEqual(2);
    checked += 1;
  }
  expect(checked, `${surface} exposed too few real keyboard stops to exercise`).toBeGreaterThanOrEqual(3);
}

async function reflowProblems(frame: Frame) {
  return frame.evaluate(() => {
    const outside = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1))
      .slice(0, 10)
      .map(({ element, rect }) => ({
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${element.className}`,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      }));
    const documentOverflow =
      document.documentElement.scrollWidth > window.innerWidth + 1
        ? `document ${document.documentElement.scrollWidth}px > viewport ${window.innerWidth}px: ${JSON.stringify(outside)}`
        : undefined;
    const nested = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        if (element.dataset.a11yEssentialHorizontal === "true") return false;
        const style = getComputedStyle(element);
        return (
          ["auto", "scroll"].includes(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 1
        );
      })
      .slice(0, 10)
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return { documentOverflow, nested };
  });
}

async function assertReflow(page: Page, surface: Surface) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const frame of page.frames()) {
    const problems = await reflowProblems(frame);
    expect(
      problems.documentOverflow,
      `${surface}${frame === page.mainFrame() ? "" : " preview"} does not reflow at 320 CSS px`,
    ).toBeUndefined();
    expect(
      problems.nested,
      `${surface}${frame === page.mainFrame() ? "" : " preview"} creates nested horizontal scrolling`,
    ).toEqual([]);
  }
}

async function assertScreenReaderTree(page: Page, surface: Surface) {
  await expect(page.getByRole("main")).toHaveCount(1);
  const tree = await page.locator("body").ariaSnapshot();

  if (surface === "setup") {
    await expect(page.getByRole("heading", { level: 1, name: "Create your owner account" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create owner account" })).toBeVisible();
    expect(tree).toContain("Create your owner account");
  } else if (surface === "admin") {
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toBeVisible();
    expect(tree).toContain("Admin sections");
  } else if (surface === "editor") {
    await expect(page.getByRole("heading", { level: 1, name: "Aurora Coast Photography" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a block" }).first()).toBeVisible();
    await expect(page.getByTitle("Preview")).toBeVisible();
    expect(tree).toContain("Preview");
  } else if (surface === "storefront") {
    await expect(page.getByRole("heading", { level: 1, name: "Coastal light, honestly made" })).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    expect(tree).toContain("Coastal light, honestly made");
  } else {
    await expect(page.getByRole("heading", { level: 1, name: "Privacy centre" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(tree).toContain("Privacy centre");
  }
}

async function assertSurface(page: Page, surface: Surface) {
  await assertScreenReaderTree(page, surface);
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([
      { name: THEME_COOKIE, value: theme, url: BASE_URL },
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await assertAxe(page, surface, theme);
  }
  await assertKeyboardAndFocus(page, surface);
  await assertReflow(page, surface);
}

function milliseconds(value: string): number[] {
  return value.split(",").map((part) => {
    const duration = part.trim();
    const number = Number.parseFloat(duration);
    return duration.endsWith("ms") ? number : number * 1_000;
  });
}

async function assertReducedMotion(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  const ordinaryTransition = await page
    .getByTitle("Preview")
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Math.max(...milliseconds(ordinaryTransition))).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))
    .toBe(true);

  for (const frame of page.frames()) {
    const problems = await frame.evaluate(() => {
      const durationMs = (value: string) =>
        value.split(",").map((part) => {
          const duration = part.trim();
          const number = Number.parseFloat(duration);
          return duration.endsWith("ms") ? number : number * 1_000;
        });
      return Array.from(document.querySelectorAll<HTMLElement>("*"))
        .flatMap((element) => {
          const style = getComputedStyle(element);
          const transition = Math.max(...durationMs(style.transitionDuration));
          const animation = Math.max(...durationMs(style.animationDuration));
          const repeats = style.animationIterationCount
            .split(",")
            .map((value) => (value.trim() === "infinite" ? Infinity : Number(value)));
          const problem =
            transition > 0.011 ||
            animation > 0.011 ||
            repeats.some((value) => value > 1) ||
            style.scrollBehavior === "smooth";
          return problem
            ? [{
                element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
                transition,
                animation,
                iterations: style.animationIterationCount,
                scrollBehavior: style.scrollBehavior,
              }]
            : [];
        })
        .slice(0, 20);
    });
    expect(problems, "reduced-motion leaves animation, transition or smooth scrolling active").toEqual([]);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function installFixtures() {
  registerBlock(formBlock as unknown as Parameters<typeof registerBlock>[0]);
  await db().insert(users).values({
    id: OWNER.userId,
    email: "owner-a11y@example.test",
    role: "owner",
  });
  await db().transaction((tx) =>
    installDemo.call({ publish: true }, OWNER, { tx, queued: [] }),
  );
  await db().insert(totpFactors).values({
    userId: OWNER.userId,
    // Session validation only needs proof that a factor exists. No code is
    // generated or accepted by this fixture, so there is no production bypass.
    encryptedSecret: "browser-accessibility-fixture",
  });
  const ownerSession = await db().transaction((tx) =>
    createSession(tx, OWNER.userId, { twoFactorVerified: true }),
  );

  await db().insert(users).values({
    id: CUSTOMER.userId,
    email: "customer-a11y@example.test",
    role: "customer",
  });
  await db().insert(contacts).values({
    userId: CUSTOMER.userId,
    name: "Morgan Accessibility",
    email: "customer-a11y@example.test",
    lifecycleStage: "customer",
    preferredLocale: "en",
    timezone: "America/Vancouver",
    country: "CA",
  });
  const customerSession = await db().transaction((tx) =>
    createSession(tx, CUSTOMER.userId),
  );
  const [home] = await db()
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.slug, ""))
    .limit(1);
  if (!home) throw new Error("The demo fixture did not create its home page.");

  return {
    customerToken: customerSession.token,
    homePageId: home.id,
    ownerToken: ownerSession.token,
  };
}

test.describe("real-browser accessibility", () => {
  test.beforeAll(resetBrowserDatabase);
  test.afterAll(async () => {
    // CI's later image and upgrade gates share the disposable database. Leave
    // them the same empty, role-seeded state this suite required on entry,
    // rather than making their behaviour depend on our demo media fixtures.
    await resetBrowserDatabase();
    await closeDb();
  });

  test("covers setup, admin, editor, storefront and portal", async ({ page, context }) => {
    test.setTimeout(240_000);

    await test.step("setup", async () => {
      await page.goto("/setup");
      await assertSurface(page, "setup");
    });

    const fixture = await installFixtures();
    await context.addCookies([
      { name: SESSION_COOKIE, value: fixture.ownerToken, url: BASE_URL },
    ]);

    await test.step("admin", async () => {
      await page.goto("/admin");
      await assertSurface(page, "admin");
    });

    await test.step("editor", async () => {
      await page.goto(`/admin/pages/${fixture.homePageId}`);
      await assertSurface(page, "editor");
      await assertReducedMotion(page);
    });

    await test.step("storefront", async () => {
      await page.goto("/");
      await assertSurface(page, "storefront");
    });

    await context.addCookies([
      { name: SESSION_COOKIE, value: fixture.customerToken, url: BASE_URL },
    ]);
    await test.step("portal", async () => {
      await page.goto("/portal/privacy");
      await assertSurface(page, "portal");
    });
  });
});
