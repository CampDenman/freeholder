// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real customer rendering of a synthetic immutable merchant snapshot.
// No provider request, acceptance or public direct-mode activation is implied.
import {createHash,randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {eq} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createSession,SESSION_COOKIE} from "@/core/auth/sessions";
import {contacts} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import {invoices,invoiceLines,invoiceMarketPolicies,payments} from "@/modules/invoicing/schema";
import {invoiceAccessToken} from "@/modules/invoicing/customer-tokens";
import {memberPayoutAccounts,memberProfiles} from "@/modules/members/schema";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import {CUSTOMER} from "../helpers/spine";
import {C11_BASE_URL,seedC11Owner} from "./owner-session";

const messages={en,es,fr,ar};
const originalName=`Original Merchant Studio ${"A".repeat(90)}`;
test.describe("original merchant invoice identity (C12.38)",()=>{
 test.afterAll(closeDb);
 for(const locale of ["en","es","fr","ar"] as const){
  test(`${locale}: preserves original public issuer through customer and private-link views`,async({browser})=>{
   await seedC11Owner("Current Platform");
   await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
   const sellerId=randomUUID(),now=new Date();
   await db().insert(users).values([{id:CUSTOMER.userId,email:"buyer@example.test",role:"customer"},{id:sellerId,email:"merchant@example.test",role:"customer"}]);
   const [contact]=await db().insert(contacts).values({userId:CUSTOMER.userId,name:"Synthetic invoice buyer",email:"buyer@example.test",preferredLocale:locale}).returning();
   await db().insert(memberProfiles).values({userId:sellerId,handle:"invoice_merchant",displayName:"Current public profile",status:"active",ageAttestedAt:now});
   await db().insert(memberPayoutAccounts).values({userId:sellerId,adapter:"stripe_connect",status:"ready",externalAccountId:"acct_OriginalInvoice",chargesReady:true,merchantName:originalName});
   const [invoice]=await db().insert(invoices).values({contactId:contact!.id,number:"INV-ORIGINAL-ISSUER",idempotencyKey:"synthetic-original-issuer",requestHash:createHash("sha256").update("synthetic-original-issuer").digest("hex"),status:"sent",currency:"CAD",subtotalMinor:10000,totalMinor:10000,issuedAt:now}).returning();
   await db().insert(invoiceLines).values({invoiceId:invoice!.id,position:0,description:"Original merchant service",quantityMicros:1000000,unitAmountMinor:10000,subtotalMinor:10000,totalMinor:10000});
   await db().insert(invoiceMarketPolicies).values({invoiceId:invoice!.id,model:"seller_merchant",adapter:"stripe_connect",siteFeeBps:1000,feeMinor:1000,holdDays:0,sellerUserId:sellerId,merchantName:originalName,providerAccountId:"acct_OriginalInvoice"});
   const buyer=await db().transaction(tx=>createSession(tx,CUSTOMER.userId));
   const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
   await context.addCookies([{name:SESSION_COOKIE,value:buyer.token,url:C11_BASE_URL}]);const page=await context.newPage();
   const path=`/portal/invoices/${invoice!.id}`;
   try{
    for(const theme of ["light","dark"]){
     await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.goto(path);
     const header=page.locator("main#main > header");
     await expect(header.getByText(originalName,{exact:true})).toBeVisible();
     await expect(header).not.toContainText("Current Platform");
     await expect(page.locator("html")).toHaveAttribute("lang",locale);
     if(locale==="ar")await expect(page.locator("html")).toHaveAttribute("dir","rtl");
     await expect(page.getByText(messages[locale]["customerInvoice.unavailable"],{exact:true})).toBeVisible();
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
     expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
     for(const privateValue of ["acct_OriginalInvoice",sellerId,"providerAccountId","siteFeeBps"])expect(await page.content()).not.toContain(privateValue);
     await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-original-issuer.png`),fullPage:true});
    }
    await page.getByRole("link",{name:messages[locale]["customerInvoice.back"],exact:true}).focus();await page.keyboard.press("Tab");
    await expect(page.getByRole("link",{name:messages[locale]["app.invoice.return"],exact:true})).toBeFocused();
    await db().update(businessProfile).set({name:"Replacement Platform"}).where(eq(businessProfile.id,1));
    await db().update(memberPayoutAccounts).set({merchantName:"Replacement Merchant Studio",externalAccountId:"acct_ReplacementInvoice"}).where(eq(memberPayoutAccounts.userId,sellerId));
    await context.clearCookies();
    await page.goto(`${path}?token=${invoiceAccessToken(invoice!)}`);
    await expect(page.locator("main#main > header").getByText(originalName,{exact:true})).toBeVisible();
    await expect(page.locator("main#main > header")).not.toContainText("Replacement");
    expect(await db().select().from(payments)).toHaveLength(0);
    expect((await page.goto(`${path}?token=${"0".repeat(64)}`))?.status()).toBe(404);
    expect(await page.content()).not.toContain(originalName);
   }finally{await context.close();}
  });
 }
});
