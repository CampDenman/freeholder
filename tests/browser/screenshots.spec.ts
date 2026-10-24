// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Living screenshots: every screen of the current app, in light and dark, at
// desktop and mobile sizes, over the Aurora Coast demo plus a signed-in
// customer. Runs only when SCREENSHOTS=1. Output: test-results/screenshots
// (WebP images plus manifest.json), published by .github/workflows/screenshots.yml.
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { API_BASE } from "@/core/api/dispatch";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { taxCategories } from "@/modules/invoicing/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { THEME_COOKIE } from "@/core/design/theme";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { cancellationPolicies, priceListEntries, priceLists, productVariants, products, serviceOfferings } from "@/modules/catalog/schema";
import { plans } from "@/modules/subscriptions/schema";
import { C11_BASE_URL, C11_OWNER } from "./owner-session";
import { resetBrowserDatabase } from "./database";

const OUT = "test-results/screenshots";
const MAX_HEIGHT = 6000;
const VARIANTS = [
  { size: "desktop", width: 1440, height: 900, theme: "light" },
  { size: "desktop", width: 1440, height: 900, theme: "dark" },
  { size: "mobile", width: 390, height: 844, theme: "light" },
  { size: "mobile", width: 390, height: 844, theme: "dark" },
] as const;
/** Pages whose job is a one-time flow that a finished install redirects away from. */
const SKIP = [/^\/setup/, /^\/playground/, /^\/portal\/magic/, /^\/(reset|invite|login\/verify|security\/verify)$/];

type Role = "public" | "owner" | "customer";
type Shot = { route: string; url: string; role: Role; title: string; slug: string; files: string[] };

function roleFor(path: string): Role {
  if (path.startsWith("/admin")) return "owner";
  if (path.startsWith("/portal") && !/^\/portal\/(login|magic)/.test(path)) return "customer";
  return "public";
}

function slugFor(path: string): string {
  return path === "/" ? "home" : path.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "");
}

/** Every page route under app/, with route groups removed, as [pattern, isDynamic]. */
function appRoutes(): { pattern: string; dynamic: boolean }[] {
  const found: { pattern: string; dynamic: boolean }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const segments = relative("app", dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        const pattern = "/" + segments.join("/");
        found.push({ pattern, dynamic: segments.some((s) => s.startsWith("[")) });
      }
    }
  };
  walk("app");
  return found;
}

function matcher(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((s) => (s.startsWith("[[...") ? "(?:.*)" : s.startsWith("[...") ? ".+" : s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}$`);
}

async function shoot(page: Page, slug: string): Promise<string[]> {
  const files: string[] = [];
  for (const v of VARIANTS) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: v.theme, url: C11_BASE_URL }]);
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(300);
    const height = Math.min(MAX_HEIGHT, await page.evaluate(() => document.documentElement.scrollHeight));
    const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: v.width, height } });
    const file = `${slug}--${v.size}--${v.theme}.webp`;
    await sharp(png).webp({ quality: 78 }).toFile(join(OUT, file));
    files.push(file);
  }
  return files;
}

async function contextFor(browser: Browser, token?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: C11_BASE_URL, reducedMotion: "reduce" });
  if (token) await context.addCookies([{ name: SESSION_COOKIE, value: token, url: C11_BASE_URL }]);
  return context;
}

/** Owner only, then the demo install performs setup the way a new owner would. */
async function seedOwner(): Promise<string> {
  await resetBrowserDatabase();
  await db().insert(users).values({ id: C11_OWNER.userId, email: "owner@example.test", role: "owner" });
  await db().insert(totpFactors).values({ userId: C11_OWNER.userId, encryptedSecret: "screenshots-browser-fixture" });
  const session = await db().transaction((tx) => createSession(tx, C11_OWNER.userId, { twoFactorVerified: true }));
  return session.token;
}

async function installDemo(ownerToken: string): Promise<void> {
  const csrf = issueCsrfToken();
  const response = await fetch(`${C11_BASE_URL}${API_BASE}/demo.install`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(ownerToken)}; ${CSRF_COOKIE}=${encodeURIComponent(csrf)}`,
      [CSRF_HEADER]: csrf,
    },
    body: JSON.stringify({ publish: true }),
  });
  if (!response.ok) throw new Error(`demo.install refused (${response.status}): ${await response.text()}`);
}

/**
 * A believable small business for the screens people will see. `demo.install`
 * already seeds Aurora Coast's shop, services, studio calendar, public
 * audience, CAD retail price list and BC GST/PST registration (C1.38), so the
 * fixture reuses those by slug and name and adds only what the demo leaves
 * out: a cancellation policy on the portrait session, a membership plan, a
 * signed-in customer and a client list with more than one person. Inserting
 * its own copies used to collide with the seed (products_slug_idx) and would
 * have put a second calendar, audience, price list and tax zone on screen.
 */
async function fixture() {
  // Fourteen days out, on a weekday the studio calendar has hours for.
  const day=new Date();day.setUTCDate(day.getUTCDate()+14);
  while(day.getUTCDay()===0||day.getUTCDay()===6)day.setUTCDate(day.getUTCDate()+1);
  const date=day.toISOString().slice(0,10);
  const one=<T>(rows:T[],what:string):T=>{if(!rows[0])throw new Error(`The demo seed no longer provides ${what}.`);return rows[0];};
  const service=one(await db().select({id:products.id}).from(products).where(eq(products.slug,"portrait-session")),"the portrait-session service");
  const offering=one(await db().select({id:serviceOfferings.id}).from(serviceOfferings).where(eq(serviceOfferings.productId,service.id)),"an offering for the portrait session");
  const retail=one(await db().select({id:priceLists.id}).from(priceLists).where(and(eq(priceLists.name,"CAD retail"),eq(priceLists.currency,"CAD"))),"the CAD retail price list");
  const standard=one(await db().select({id:taxCategories.id}).from(taxCategories).where(eq(taxCategories.code,"standard")),"the standard tax category");
  const [customer]=await db().insert(users).values({email:"maya.chen@example.test",role:"customer"}).returning();
  await db().insert(contacts).values({email:customer!.email,name:"Maya Chen",userId:customer!.id,lifecycleStage:"customer",source:"booking"});
  await db().insert(contacts).values([
    {email:"jordan.okafor@example.test",name:"Jordan Okafor",lifecycleStage:"repeat",source:"booking"},
    {email:"priya.sandhu@example.test",name:"Priya Sandhu",lifecycleStage:"customer",source:"booking"},
    {email:"luc.tremblay@example.test",name:"Luc Tremblay",lifecycleStage:"prospect",source:"contact-form"},
    {email:"hannah.wright@example.test",name:"Hannah Wright",lifecycleStage:"repeat",source:"referral"},
    {email:"sam.nguyen@example.test",name:"Sam Nguyen",lifecycleStage:"lead",source:"newsletter"},
    {email:"aiyana.george@example.test",name:"Aiyana George",lifecycleStage:"customer",source:"booking"},
    {email:"ben.kowalski@example.test",name:"Ben Kowalski",lifecycleStage:"lead",source:"contact-form"},
  ]);
  const session=await db().transaction(tx=>createSession(tx,customer!.id));
  const [policy]=await db().insert(cancellationPolicies).values({name:"48-hour notice",freeUntilHours:48,feeType:"percent",feeValue:500000,rescheduleLimit:2}).returning();
  await db().update(serviceOfferings).set({cancellationPolicyId:policy!.id}).where(eq(serviceOfferings.id,offering.id));
  const [membership]=await db().insert(products).values({name:"Community membership",slug:"community-membership",kind:"digital",status:"active",taxCategoryId:standard.id,publishedAt:new Date()}).returning();
  const [variant]=await db().insert(productVariants).values({productId:membership!.id,sku:randomUUID(),combinationKey:"default",isDefault:true}).returning();
  await db().insert(priceListEntries).values({priceListId:retail.id,variantId:variant!.id,amountMinor:2000});
  await db().insert(plans).values({productId:membership!.id,name:"Community membership",status:"active",billingMode:"manual",interval:"month"});
  return {date,serviceId:service.id,customerId:customer!.id,token:session.token};
}

test.describe("living screenshots", () => {
  test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture screenshots.");
  test.setTimeout(55 * 60_000);
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });

  test("every screen", async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const ownerToken = await seedOwner();
    await installDemo(ownerToken);
    const data = await fixture();
    const contexts: Record<Role, BrowserContext> = {
      public: await contextFor(browser),
      owner: await contextFor(browser, ownerToken),
      customer: await contextFor(browser, data.token),
    };
    const shots: Shot[] = [];
    const skipped: { route: string; reason: string }[] = [];
    const seen = new Set<string>();

    // Customer journey first, so the portal has a booking, invoices and a membership.
    const journey = await contexts.customer.newPage();
    const step = async (slug: string, route: string) => {
      shots.push({ route, url: new URL(journey.url()).pathname, role: "customer", title: await journey.title(), slug, files: await shoot(journey, slug) });
    };
    await journey.goto(`/book?service=${data.serviceId}&date=${data.date}`);
    await step("journey-01-booking-choose-time", "/book");
    await journey.getByLabel("I agree to the price and cancellation policy shown above.").first().check();
    await journey.getByRole("button", { name: "Reserve this time", exact: true }).first().click();
    await expect(journey).toHaveURL(/\/portal\/records\/bookings\/[a-f0-9-]+\?booked=1$/);
    await step("journey-02-booking-confirmed", "/portal/records/[section]/[id]");
    await journey.getByRole("link", { name: "Open invoice", exact: true }).click();
    await step("journey-03-pay-booking-invoice", "/portal/invoices/[id]");
    await journey.goto("/memberships");
    await journey.getByLabel("I agree to this membership’s price, renewal and cancellation terms.").check();
    await journey.getByRole("button", { name: "Join membership", exact: true }).click();
    await expect(journey).toHaveURL(/\/portal\/invoices\/[a-f0-9-]+$/);
    await step("journey-04-pay-membership-invoice", "/portal/invoices/[id]");
    await journey.close();

    const routes = appRoutes();
    const hrefs = new Set<string>();
    const visit = async (route: string, path: string) => {
      if (seen.has(path) || SKIP.some((re) => re.test(path))) return;
      seen.add(path);
      const role = roleFor(path);
      const page = await contexts[role].newPage();
      try {
        const response = await page.goto(path, { waitUntil: "load" });
        const landed = new URL(page.url()).pathname;
        if (!response || response.status() >= 400) { skipped.push({ route, reason: `HTTP ${response?.status() ?? "none"}` }); return; }
        if (landed !== path) { skipped.push({ route, reason: `redirects to ${landed}` }); return; }
        for (const href of await page.$$eval("a[href^='/']", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))) {
          hrefs.add(href.split(/[?#]/)[0]!);
        }
        const slug = slugFor(path);
        shots.push({ route, url: path, role, title: await page.title(), slug, files: await shoot(page, slug) });
      } catch (error) {
        skipped.push({ route, reason: String(error).slice(0, 200) });
      } finally {
        await page.close();
      }
    };

    await visit("/", "/");
    for (const { pattern } of routes.filter((r) => !r.dynamic)) await visit(pattern, pattern);
    // Record pages: the first link the app itself offers for each dynamic route.
    for (const { pattern } of routes.filter((r) => r.dynamic && !r.pattern.includes("[[..."))) {
      const re = matcher(pattern);
      const href = [...hrefs].find((h) => re.test(h) && !seen.has(h));
      if (href) await visit(pattern, href);
      else skipped.push({ route: pattern, reason: "no link to a record of this kind in the demo" });
    }
    // Public CMS pages live behind the catch-all route; capture the ones the site links to.
    const staticPatterns = routes.filter((r) => !r.pattern.includes("[[...")).map((r) => matcher(r.pattern));
    const cmsPages = [...hrefs].filter((h) => roleFor(h) === "public" && !seen.has(h) && !staticPatterns.some((re) => re.test(h)) && !/^\/(api|media|og|ics|feeds|go|s|share|unsubscribe)\b/.test(h));
    for (const href of cmsPages.slice(0, 40)) await visit("/[[...slug]]", href);
    for (const context of Object.values(contexts)) await context.close();

    writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ capturedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, shots, skipped }, null, 2));
    expect(shots.length).toBeGreaterThan(50);
    void randomUUID; void C11_OWNER;
  });
});
