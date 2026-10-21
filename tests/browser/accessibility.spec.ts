// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Chromium accessibility acceptance coverage for MASTER.md §43 C1.21.
// Static HTML helpers remain useful unit checks, but only a browser can prove
// layout reflow, keyboard focus, media preferences and the accessibility tree.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { API_BASE } from "@/core/api/dispatch";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { THEME_COOKIE } from "@/core/design/theme";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { pages } from "@/modules/cms/schema";
import { t } from "@/core/i18n";
import { businessProfile } from "@/core/settings/schema";
import { bookings, calendars } from "@/core/scheduling/schema";
import { invoices } from "@/modules/invoicing/schema";
import { products } from "@/modules/catalog/schema";
import {
  closeDb,
  CUSTOMER,
  OWNER,
} from "../helpers/spine";
import { resetBrowserDatabase } from "./database";

type Surface = "setup" | "admin" | "updates" | "editor" | "storefront" | "portal";

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

async function assertAxe(page: Page, surface: string, theme: "light" | "dark") {
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

async function assertKeyboardAndFocus(page: Page, surface: string, locale = "en") {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(page.url().split("#", 1)[0]!, { waitUntil: "domcontentloaded" });

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: t(locale, "a11y.skipToContent") });
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

async function assertReflow(page: Page, surface: string) {
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
    await expect(page.getByRole("heading", { level: 2, name: "Your first wins" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: /tasks complete/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Guided help" })).toBeVisible();
    expect(tree).toContain("Admin sections");
  } else if (surface === "updates") {
    // The update surface (C10.20). Asserted on its own terms rather than the
    // overview's: it is a different page, and reusing the overview's checks
    // here would have tested that Updates looks like the dashboard.
    await expect(page.getByRole("heading", { level: 1, name: "Updates" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toBeVisible();
    // The policy form is the part a keyboard user has to operate, so its
    // grouping and labelling are what matter most on this screen.
    await expect(page.getByRole("group", { name: "Nights an update may land" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Release channel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check for updates now" })).toBeVisible();
    expect(tree).toContain("Updates");
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
    await expect(page.getByRole("heading", { level: 2, name: "Your first wins" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: /tasks complete/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Guided help" })).toBeVisible();
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

async function installDemoThroughApp(sessionToken: string): Promise<void> {
  // `demo.install` is an orchestrator, so `.call()` always awaits `ready()`.
  // Playwright cannot boot: manifests load services through dynamic `@/`
  // imports, and this runner only rewrites static ones. The standalone
  // server already booted, which is also the path an owner uses.
  const csrf = issueCsrfToken();
  const response = await fetch(`${BASE_URL}${API_BASE}/demo.install`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; ${CSRF_COOKIE}=${encodeURIComponent(csrf)}`,
      [CSRF_HEADER]: csrf,
    },
    body: JSON.stringify({ publish: true }),
  });
  if (response.ok) return;
  throw new Error(
    `The running app refused demo.install (${response.status}): ${await response.text()}`,
  );
}

async function installFixtures() {
  await db().insert(users).values({
    id: OWNER.userId,
    email: "owner-a11y@example.test",
    role: "owner",
  });
  await db().insert(totpFactors).values({
    userId: OWNER.userId,
    // Session validation only needs proof that a factor exists. No code is
    // generated or accepted by this fixture, so there is no production bypass.
    encryptedSecret: "browser-accessibility-fixture",
  });
  const ownerSession = await db().transaction((tx) =>
    createSession(tx, OWNER.userId, { twoFactorVerified: true }),
  );
  await installDemoThroughApp(ownerSession.token);

  await db().insert(users).values({
    id: CUSTOMER.userId,
    email: "customer-a11y@example.test",
    role: "customer",
  });
  const [a11yContact] = await db().insert(contacts).values({
    userId: CUSTOMER.userId,
    name: "Morgan Accessibility",
    email: "customer-a11y@example.test",
    lifecycleStage: "customer",
    preferredLocale: "en",
    timezone: "America/Vancouver",
    country: "CA",
  }).returning({ id: contacts.id });
  const customerSession = await db().transaction((tx) =>
    createSession(tx, CUSTOMER.userId),
  );

  // C11.12 populated detail forms: real rows behind the highest-traffic
  // admin record routes, so axe, the keyboard loop and the 320px reflow all
  // exercise the forms a person actually operates. The invoice shape mirrors
  // tests/browser/journeys.spec.ts's money console fixture; the demo install
  // only seeds pages, so the product and the sitting are created here.
  const invoiceId = randomUUID();
  await db().insert(invoices).values({
    id: invoiceId,
    contactId: a11yContact!.id,
    number: "INV-A11Y-1",
    idempotencyKey: "a11y-detail-invoice",
    requestHash: createHash("sha256")
      .update("a11y-detail-invoice")
      .digest("hex"),
    status: "sent",
    currency: "CAD",
    subtotalMinor: 5_000,
    discountMinor: 0,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 5_000,
    paidMinor: 0,
    refundedMinor: 0,
    issuedAt: new Date(),
  });
  const [product] = await db()
    .insert(products)
    .values({
      name: "Accessibility Harbour Print",
      slug: "accessibility-harbour-print",
      kind: "physical",
    })
    .returning({ id: products.id });
  const [calendar] = await db()
    .insert(calendars)
    .values({
      kind: "resource",
      name: "Accessibility studio",
      slug: "accessibility-studio",
      timezone: "America/Vancouver",
    })
    .returning({ id: calendars.id });
  const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const [booking] = await db()
    .insert(bookings)
    .values({
      contactId: a11yContact!.id,
      calendarId: calendar!.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      timezoneAtBooking: "America/Vancouver",
      status: "confirmed",
    })
    .returning({ id: bookings.id });
  const [home] = await db()
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.slug, ""))
    .limit(1);
  if (!home) throw new Error("The demo fixture did not create its home page.");

  return {
    bookingId: booking!.id,
    contactId: a11yContact!.id,
    customerToken: customerSession.token,
    homePageId: home.id,
    invoiceId,
    ownerToken: ownerSession.token,
    productId: product!.id,
  };
}

async function publishLocales(defaultLocale: string, enabled: string[]) {
  await db()
    .update(businessProfile)
    .set({ defaultLocale, enabledLocales: enabled })
    .where(eq(businessProfile.id, 1));
}

async function assertHeadingAxeAndSkip(
  page: Page,
  path: string,
  heading: string,
  locale = "en",
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: BASE_URL }]);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await assertAxe(page, path, theme);
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: t(locale, "a11y.skipToContent") }),
  ).toBeFocused();
}

/**
 * C11.12 populated record surfaces: a real database row behind the route, so
 * the axe pass, the 12-stop keyboard loop and the 320px reflow all exercise
 * the form a person actually operates — not an empty-state list scan.
 */
async function assertRecordSurface(
  page: Page,
  surface: string,
  path: string,
  heading: RegExp | string,
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: BASE_URL }]);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await assertAxe(page, surface, theme);
  }
  await assertKeyboardAndFocus(page, surface);
  await assertReflow(page, surface);
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
    test.setTimeout(540_000);

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

    // The update surface (C10.20) carries the one status line an owner acts
    // on, plus the policy form. It is checked in a real browser rather than
    // assumed, because a screen nobody can operate by keyboard is a screen
    // that quietly stops being the way updates get applied.
    await test.step("admin updates", async () => {
      await page.goto("/admin/updates");
      await assertSurface(page, "updates");
    });

    await test.step("admin F04 screens", async () => {
      for (const [path, heading] of [
        ["/admin/roles", t("en", "roles.title")],
        ["/admin/invitations", t("en", "invitations.title")],
        ["/admin/contacts", t("en", "contacts.title")],
        ["/admin/health", t("en", "doctor.title")],
        ["/admin/settings", t("en", "admin.settings.title")],
        ["/admin/plugins", t("en", "plugins.title")],
        ["/admin/work", t("en", "work.title")],
      ] as const) {
        await assertHeadingAxeAndSkip(page, path, heading);
      }
    });

    // C11.12 owner lists: both themes, heading + axe + skip, not the full surface
    // pass. Record-id detail pages stay out unless a fixture already exists.
    await test.step("admin F04 leftover list screens", async () => {
      for (const [path, heading] of [
        ["/admin/search", t("en", "admin.search.title")],
        ["/admin/retention", t("en", "admin.retention.title")],
        ["/admin/payments", t("en", "payments.title")],
        ["/admin/messaging", t("en", "messaging.title")],
        ["/admin/pipeline", t("en", "pipeline.title")],
        ["/admin/products", t("en", "catalog.title")],
        ["/admin/redirects", t("en", "seo.redirects.title")],
        ["/admin/pages", t("en", "cms.pages.title")],
        ["/admin/community", t("en", "community.title")],
        ["/admin/voice-video", t("en", "voiceVideo.title")],
        ["/admin/inbox", t("en", "inbox.title")],
        ["/admin/invoices", t("en", "invoices.title")],
        ["/admin/orders", t("en", "catalog.orders.title")],
        ["/admin/galleries", t("en", "galleries.title")],
        ["/admin/quotes", t("en", "quotes.title")],
        ["/admin/forms", t("en", "forms.title")],
        ["/admin/media", t("en", "media.title")],
        ["/admin/jobs", t("en", "jobs.title")],
        ["/admin/locations", t("en", "admin.locations.title")],
        ["/admin/calendar", t("en", "calendar.title")],
        ["/admin/automations", t("en", "automations.title")],
        ["/admin/reports", t("en", "reports.title")],
        ["/admin/newsletters", t("en", "newsletters.title")],
        ["/admin/appointments", t("en", "appointments.title")],
        ["/admin/documents", t("en", "documents.title")],
        ["/admin/events", t("en", "events.title")],
        ["/admin/projects", t("en", "projects.title")],
        ["/admin/tasks", t("en", "tasks.title")],
        ["/admin/segments", t("en", "segments.title")],
        ["/admin/reviews", t("en", "reviews.title")],
        ["/admin/social", t("en", "social.title")],
        ["/admin/subscriptions", t("en", "subscriptions.title")],
        // C11.12 remaining unrouted owner screens: the list scan above left
        // these admin pages unproved, so they join the same heading + both
        // themes + axe + bypass-link pass.
        ["/admin/ads", t("en", "ads.title")],
        ["/admin/calendars", t("en", "calendars.title")],
        ["/admin/design", t("en", "design.title")],
        ["/admin/pos", t("en", "pos.title")],
        ["/admin/loyalty", t("en", "loyalty.title")],
        ["/admin/marketplace", t("en", "marketplace.title")],
        ["/admin/gifts", t("en", "gifts.title")],
        ["/admin/assistant", t("en", "assistant.title")],
        ["/admin/shipping", t("en", "catalog.shipping.title")],
        ["/admin/traffic", t("en", "analytics.title")],
      ] as const) {
        await assertHeadingAxeAndSkip(page, path, heading);
      }
    });

    // C11.12 populated detail forms: highest-traffic admin record routes with
    // a real row behind them. axe runs in both asserted themes, then the full
    // keyboard loop and the 320px reflow run against the populated form.
    await test.step("admin detail forms with real records", async () => {
      await assertRecordSurface(
        page,
        "admin-contact-detail",
        `/admin/contacts/${fixture.contactId}`,
        "Morgan Accessibility",
      );
      await assertRecordSurface(
        page,
        "admin-invoice-detail",
        `/admin/invoices/${fixture.invoiceId}`,
        /INV-A11Y-1/,
      );
      await assertRecordSurface(
        page,
        "admin-product-detail",
        `/admin/products/${fixture.productId}`,
        "Accessibility Harbour Print",
      );
      await assertRecordSurface(
        page,
        "admin-appointment-detail",
        `/admin/appointments/${fixture.bookingId}`,
        /\d/,
      );
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

    await test.step("French, Spanish and catalog-driven Arabic RTL", async () => {
      await publishLocales("fr", ["en", "fr", "es"]);
      await page.goto("/admin");
      await expect(page.locator("html")).toHaveAttribute("lang", "fr");
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await expect(
        page.getByRole("heading", { level: 1, name: t("fr", "admin.overview.title") }),
      ).toBeVisible();
      await assertAxe(page, "admin-fr", "light");
      await assertKeyboardAndFocus(page, "admin-fr", "fr");

      await page.goto("/fr");
      await expect(page.locator("html")).toHaveAttribute("lang", "fr");
      await assertAxe(page, "storefront-fr", "light");
      // The 320px reflow contract applies to every shipped locale, not just
      // the default one: French and Spanish storefronts join it here, and the
      // Arabic catalog pass below proves it for RTL.
      await page.setViewportSize({ width: 320, height: 800 });
      await page.reload({ waitUntil: "domcontentloaded" });
      let problems = await reflowProblems(page.mainFrame());
      expect(problems.documentOverflow, "storefront-fr does not reflow at 320 CSS px").toBeUndefined();
      expect(problems.nested, "storefront-fr creates nested horizontal scrolling").toEqual([]);

      await publishLocales("es", ["en", "fr", "es"]);
      await page.goto("/es");
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await assertAxe(page, "storefront-es", "light");
      await page.setViewportSize({ width: 320, height: 800 });
      await page.reload({ waitUntil: "domcontentloaded" });
      problems = await reflowProblems(page.mainFrame());
      expect(problems.documentOverflow, "storefront-es does not reflow at 320 CSS px").toBeUndefined();
      expect(problems.nested, "storefront-es creates nested horizontal scrolling").toEqual([]);
      await page.setViewportSize({ width: 1280, height: 800 });

      // C11.12 RTL is proved by the shipped Arabic catalog, not an injected
      // dir attribute: enabling ar makes the root layout render lang="ar"
      // dir="rtl" from the locale's script, and the same axe, keyboard and
      // reflow assertions that cover English now run against the RTL admin,
      // storefront and portal. Covered matrix: locale (en/fr/es/ar) × theme
      // (axe asserted in light and dark on admin and detail surfaces; RTL
      // admin in both themes) × viewport (1280 keyboard loop, 320 reflow).
      await publishLocales("ar", ["en", "fr", "es", "ar"]);
      await context.addCookies([
        { name: SESSION_COOKIE, value: fixture.ownerToken, url: BASE_URL },
      ]);
      await page.goto("/admin");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(
        page.getByRole("heading", { level: 1, name: t("ar", "admin.overview.title") }),
      ).toBeVisible();
      for (const theme of ["light", "dark"] as const) {
        await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: BASE_URL }]);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await assertAxe(page, "admin-ar", theme);
      }
      await assertKeyboardAndFocus(page, "admin-ar", "ar");
      await assertReflow(page, "admin-ar");

      await page.context().addCookies([{ name: THEME_COOKIE, value: "light", url: BASE_URL }]);
      await page.goto("/ar");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await assertAxe(page, "storefront-ar", "light");
      await assertKeyboardAndFocus(page, "storefront-ar", "ar");
      await assertReflow(page, "storefront-ar");

      // Portal RTL follows the signed-in contact's preferred locale, resolved
      // against the enabled set — the same path a real Arabic-speaking
      // customer takes.
      await db()
        .update(contacts)
        .set({ preferredLocale: "ar" })
        .where(eq(contacts.id, fixture.contactId));
      await context.addCookies([
        { name: SESSION_COOKIE, value: fixture.customerToken, url: BASE_URL },
      ]);
      await page.goto("/portal");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: t("ar", "portal.greeting", { name: "Morgan Accessibility" }),
        }),
      ).toBeVisible();
      await assertAxe(page, "portal-ar", "light");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: t("ar", "a11y.skipToContent") }),
      ).toBeFocused();
      await page.setViewportSize({ width: 320, height: 800 });
      await page.reload({ waitUntil: "domcontentloaded" });
      problems = await reflowProblems(page.mainFrame());
      expect(problems.documentOverflow, "portal-ar does not reflow at 320 CSS px").toBeUndefined();
      expect(problems.nested, "portal-ar creates nested horizontal scrolling").toEqual([]);
      await page.setViewportSize({ width: 1280, height: 800 });

      // Restore the English-default policy and fixture contact for the
      // portal steps below.
      await db()
        .update(contacts)
        .set({ preferredLocale: "en" })
        .where(eq(contacts.id, fixture.contactId));
      await publishLocales("en", ["en", "fr", "es"]);
    });

    await context.addCookies([
      { name: SESSION_COOKIE, value: fixture.customerToken, url: BASE_URL },
    ]);
    await test.step("portal", async () => {
      await page.goto("/portal/privacy");
      await assertSurface(page, "portal");
      const guide = page.locator('[data-guidance-flow="core.customer-first-win"]');
      await guide.getByRole("button", { name: "Start guide" }).click();
      await expect(guide.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "1 of 2 tasks complete",
      );
      await page.locator("#privacy-preferences").getByRole("button", { name: "Allow" }).first().click();
      await expect(guide.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "2 of 2 tasks complete",
      );
      await expect(guide.locator("header").getByText("Completed")).toBeVisible();
    });

    await test.step("portal rooms", async () => {
      await assertHeadingAxeAndSkip(
        page,
        "/portal",
        t("en", "portal.greeting", { name: "Morgan Accessibility" }),
      );
      await assertHeadingAxeAndSkip(page, "/portal/profile", t("en", "portal.nav.profile"));
    });
  });
});
