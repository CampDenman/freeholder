// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Screenshots of the customer booking, payment and portal screens, for docs and
// review. Runs only when SCREENSHOTS=1; images land in test-results/screenshots.
import { test, expect, type Page } from "@playwright/test";
import { THEME_COOKIE } from "@/core/design/theme";
import { randomUUID } from "node:crypto";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { calendars, calendarMemberships, availabilityRules } from "@/core/scheduling/schema";
import { bookingAudiences, bookingAudienceServices } from "@/core/scheduling/audience-schema";
import { priceListEntries, priceLists, productVariants, products, serviceOfferings, priceRules } from "@/modules/catalog/schema";
import { plans } from "@/modules/subscriptions/schema";
import { seedC11Owner, C11_BASE_URL, C11_OWNER } from "./owner-session";

const OUT = "test-results/screenshots";
const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function shoot(page: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.reload();
      await page.waitForLoadState("load");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name}--${size.name}--${theme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function fixture() {
  const day=new Date();day.setUTCDate(day.getUTCDate()+14);
  const date=day.toISOString().slice(0,10);
  const [customer]=await db().insert(users).values({email:"visitor@example.test",role:"customer"}).returning();
  await db().insert(contacts).values({email:customer!.email,name:"Visitor",userId:customer!.id});
  const session=await db().transaction(tx=>createSession(tx,customer!.id));
  const [service, membership]=await db().insert(products).values([{name:"Public session",slug:"public-session",kind:"service",status:"active",publishedAt:new Date()},{name:"Community membership",slug:"community-membership",kind:"digital",status:"active",publishedAt:new Date()}]).returning();
  const variants=await db().insert(productVariants).values([service!,membership!].map(p=>({productId:p.id,sku:randomUUID(),combinationKey:"default",isDefault:true}))).returning();
  const [priceList]=await db().insert(priceLists).values({name:"Public prices",currency:"CAD",active:true}).returning();
  await db().insert(priceListEntries).values(variants.map(v=>({priceListId:priceList!.id,variantId:v.id,amountMinor:10000})));
  const [offering]=await db().insert(serviceOfferings).values({productId:service!.id,durationMin:60,locationType:"in_person"}).returning();
  await db().insert(priceRules).values({productId:service!.id,mode:"full"});
  const [calendar]=await db().insert(calendars).values({kind:"person",userId:C11_OWNER.userId,name:"Appointments",slug:"appointments",timezone:"UTC",minNoticeMin:0}).returning();
  await db().insert(availabilityRules).values({calendarId:calendar!.id,weekday:day.getUTCDay(),starts:"09:00",ends:"17:00",kind:"bookable"});
  await db().insert(calendarMemberships).values({calendarId:calendar!.id,serviceOfferingId:offering!.id,role:"primary"});
  const [audience]=await db().insert(bookingAudiences).values({name:"Public",slug:"public",who:"public",hours:"calendar",minNoticeMin:0}).returning();
  await db().insert(bookingAudienceServices).values({audienceId:audience!.id,serviceOfferingId:offering!.id});
  await db().insert(plans).values({productId:membership!.id,name:"Community membership",status:"active",billingMode:"manual",interval:"month"});
  return {date,serviceId:service!.id,customerId:customer!.id,token:session.token};
}

test.describe("customer screenshots", () => {
  test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture screenshots.");
  test.setTimeout(300000);
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });
  test("booking, payment and the customer dashboard", async ({ page, context }) => {
    await seedC11Owner("Aurora Coast Photography");
    const data = await fixture();
    await page.goto(`/book?service=${data.serviceId}&date=${data.date}`);
    await shoot(page, "01-booking-signed-out");
    await context.addCookies([{ name: SESSION_COOKIE, value: data.token, url: C11_BASE_URL }]);
    await page.reload();
    await shoot(page, "02-booking-choose-time");
    await page.getByLabel("I agree to the price and cancellation policy shown above.").first().check();
    await page.getByRole("button", { name: "Reserve this time", exact: true }).first().click();
    await expect(page).toHaveURL(/\/portal\/records\/bookings\/[a-f0-9-]+\?booked=1$/);
    await shoot(page, "03-booking-confirmed");
    await page.getByRole("link", { name: "Open invoice", exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/invoices\/[a-f0-9-]+/);
    await shoot(page, "04-pay-booking-invoice");
    await page.goto("/memberships");
    await shoot(page, "05-memberships");
    await page.getByLabel("I agree to this membership’s price, renewal and cancellation terms.").check();
    await page.getByRole("button", { name: "Join membership", exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/invoices\/[a-f0-9-]+$/);
    await shoot(page, "06-pay-membership-invoice");
    await page.goto("/portal");
    await shoot(page, "07-customer-dashboard");
    for (const path of ["/portal/invoices", "/portal/appointments", "/portal/subscriptions", "/portal/profile", "/portal/messages"]) {
      const response = await page.goto(path);
      if (response && response.ok()) await shoot(page, `08-portal-${path.split("/").at(-1)}`);
    }
    void C11_OWNER;
  });
});
