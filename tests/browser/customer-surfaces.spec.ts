// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.26/C6.19/C8.17/C9.38: real browser forms with a disposable database.
import { THEME_COOKIE } from "@/core/design/theme";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { calendars, calendarMemberships, availabilityRules } from "@/core/scheduling/schema";
import { bookingAudiences, bookingAudienceServices } from "@/core/scheduling/audience-schema";
import { priceListEntries, priceLists, productVariants, products, serviceOfferings, priceRules } from "@/modules/catalog/schema";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { seedC11Owner, useOwnerSession, C11_BASE_URL, C11_OWNER } from "./owner-session";

async function assertThemes(page: Page) {
  for (const theme of ["light", "dark"]) {
    await page.context().addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
    expect(result.violations).toEqual([]);
    expect(result.incomplete.filter(item=>item.id==="color-contrast")).toEqual([]);
  }
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

test.describe("public customer surfaces",()=>{
  test.setTimeout(240000);
  test.afterAll(async()=>{const {closeDb}=await import("@/core/db");await closeDb();});
  test("an owner writes and publishes a post that appears in the blog",async({page,context})=>{
    const owner=await seedC11Owner("Public journeys");await useOwnerSession(context,owner);
    await page.goto("/admin/blog");
    await page.getByLabel("Title",{exact:true}).fill("First public post");
    await page.getByLabel("Web address",{exact:true}).fill("first-public-post");
    await page.getByRole("button",{name:"Create draft post",exact:true}).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[a-f0-9-]+$/);
    const draft=await page.request.get("/blog");expect(await draft.text()).not.toContain('href="/blog/first-public-post"');
    await page.getByRole("button",{name:"Publish",exact:true}).click();
    await expect(page.getByText("Live",{exact:true})).toBeVisible();
    await page.goto("/blog");
    await expect(page.getByRole("link",{name:"First public post",exact:true})).toBeVisible();
    await assertThemes(page);
    await page.getByRole("link",{name:"First public post",exact:true}).click();
    await expect(page.getByRole("heading",{name:"First public post",exact:true})).toBeVisible();
    await page.goto("/newsletters");
    await expect(page.getByRole("heading",{name:"Newsletters",exact:true})).toBeVisible();
    await page.goto("/admin/newsletters/broadcasts");
    await expect(page.getByRole("link",{name:"Configure mail",exact:true})).toHaveAttribute("href","/admin/settings#mail");
    await assertThemes(page);
  });
  test("a customer reserves, moves and cancels an appointment, then joins a membership awaiting payment",async({page,context,browser})=>{
    await seedC11Owner("Public journeys");const data=await fixture();
    await page.goto(`/book?service=${data.serviceId}&date=${data.date}`);
    await expect(page.getByRole("link",{name:"Verify your email to reserve a time"})).toBeVisible();
    await assertThemes(page);
    await context.addCookies([{name:SESSION_COOKIE,value:data.token,url:C11_BASE_URL}]);
    await page.reload();
    await page.getByLabel("I agree to the price and cancellation policy shown above.").first().check();
    await page.getByRole("button",{name:"Reserve this time",exact:true}).first().click();
    await expect(page).toHaveURL(/\/portal\/records\/bookings\/[a-f0-9-]+\?booked=1$/);
    const firstRecord=new URL(page.url()).pathname;
    await expect(page.getByRole("link",{name:"Open invoice",exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Reschedule appointment",exact:true}).click();
    await page.getByLabel("Date",{exact:true}).fill(data.date);
    await page.getByRole("button",{name:"Find available times",exact:true}).click();
    await page.getByLabel("I agree to move this appointment under its original cancellation policy.").nth(4).check();
    await page.getByRole("button",{name:"Reschedule appointment",exact:true}).nth(4).click();
    await expect(page).toHaveURL(/\/portal\/records\/bookings\/[a-f0-9-]+\?saved=1$/);
    expect(new URL(page.url()).pathname).not.toBe(firstRecord);
    await page.getByLabel("I want to cancel this appointment under its cancellation policy.").check();
    await page.getByRole("button",{name:"Cancel appointment",exact:true}).click();
    await expect(page.getByText("cancelled",{exact:true})).toBeVisible();
    const ownRecord=new URL(page.url()).pathname;
    const outsider=await browser.newContext({baseURL:C11_BASE_URL});const outside=await outsider.newPage();
    const denied=await outside.request.post("/api/v1/portal.myRecord",{data:{section:"bookings",id:ownRecord.split("/").at(-1)}});
    expect(denied.status()).toBe(401);await outsider.close();
    await page.goto("/memberships");
    await page.getByLabel("I agree to this membership’s price, renewal and cancellation terms.").check();
    await page.getByRole("button",{name:"Join membership",exact:true}).click();
    await expect(page).toHaveURL(/\/portal\/invoices\/[a-f0-9-]+$/);
    const [subscription]=await db().select().from(subscriptions).where(eq(subscriptions.contactId,(await db().select().from(contacts).where(eq(contacts.userId,data.customerId)))[0]!.id));
    expect(subscription?.signupPending).toBe(true);expect(subscription?.status).toBe("paused");
    await page.goto(`/portal/subscriptions/${subscription!.id}`);
    await expect(page.getByText("Your membership is awaiting its first payment. Access starts after payment is confirmed.")).toBeVisible();
    await assertThemes(page);
    await page.getByLabel("Yes, cancel this membership.").check();
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(page).toHaveURL(/cancelled=1/);
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id,subscription!.id)))[0]?.status).toBe("cancelled");
  });
});
