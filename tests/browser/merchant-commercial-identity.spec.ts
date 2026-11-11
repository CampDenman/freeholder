// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real browser presentation of explicitly synthetic financial records.
// Provider acceptance is not inferred; Stripe is unconfigured in this run.
import {createHash,randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import{expect,test,type Page}from"@playwright/test";
import{eq}from"drizzle-orm";
import{db,closeDb}from"@/core/db";
import{users}from"@/core/auth/schema";
import{createSession,SESSION_COOKIE}from"@/core/auth/sessions";
import{contacts}from"@/core/contacts/schema";
import{businessProfile}from"@/core/settings/schema";
import{ERASED_MERCHANT_NAME}from"@/core/commerce/merchant-identity";
import{THEME_COOKIE}from"@/core/design/theme";
import{invoices,invoiceLines,invoiceMarketPolicies,payments,paymentMerchantRoutes}from"@/modules/invoicing/schema";
import{paymentReturnToken}from"@/modules/invoicing/customer-tokens";
import{memberPayoutAccounts,memberProfiles,memberSettings}from"@/modules/members/schema";
import en from"../../locales/en.json";
import es from"../../locales/es.json";
import fr from"../../locales/fr.json";
import ar from"../../locales/ar.json";
import{CUSTOMER}from"../helpers/spine";
import{C11_BASE_URL,seedC11Owner}from"./owner-session";

const messages={en,es,fr,ar},originalName=`Studio قمر ${"A".repeat(90)}`;
const support={email:"support@original-studio.example",phone:"+1 250 555 0123",url:`https://original-studio.example/help/${"a".repeat(160)}`,address:{line1:"10 Public Studio Lane",line2:null,city:"Victoria",state:"BC",postalCode:"V8W 1P6",country:"CA"}};
const replacement={...support,email:"replacement@studio.example",url:"https://replacement.example/help"};
type Locale=keyof typeof messages;
async function fixture(locale:Locale){
 await seedC11Owner("Current Platform");const now=new Date(),sellerId=randomUUID();
 await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
 await db().insert(users).values([{id:CUSTOMER.userId,email:"buyer@example.test",role:"customer"},{id:sellerId,email:"private-merchant@example.test",role:"customer"}]);
 const [buyer]=await db().insert(contacts).values({userId:CUSTOMER.userId,name:"Synthetic buyer",email:"buyer@example.test",preferredLocale:locale}).returning();
 const [seller]=await db().insert(contacts).values({userId:sellerId,name:"Current public member profile",email:"private-merchant@example.test",preferredLocale:locale}).returning();
 await db().insert(memberProfiles).values({userId:sellerId,handle:"commercial_merchant",displayName:"Current public member profile",status:"active",ageAttestedAt:now});
 await db().insert(memberSettings).values({id:1,marketplaceEnabled:true,payoutModel:"hold",payoutAdapter:"stripe_connect"});
 await db().insert(memberPayoutAccounts).values({userId:sellerId,adapter:"stripe_connect",status:"ready",externalAccountId:"acct_OriginalCommercial",chargesReady:true,merchantName:originalName,merchantSupport:support});
 const [invoice]=await db().insert(invoices).values({contactId:buyer!.id,number:"INV-ORIGINAL-BUSINESS",idempotencyKey:"synthetic-commercial",requestHash:createHash("sha256").update("synthetic-commercial").digest("hex"),status:"sent",currency:"CAD",subtotalMinor:10000,totalMinor:10000,issuedAt:now}).returning();
 await db().insert(invoiceLines).values({invoiceId:invoice!.id,position:0,description:"Original merchant service",quantityMicros:1000000,unitAmountMinor:10000,subtotalMinor:10000,totalMinor:10000});
 // Existing original seller policy; public direct-model activation remains off.
 await db().insert(invoiceMarketPolicies).values({invoiceId:invoice!.id,model:"seller_merchant",adapter:"stripe_connect",siteFeeBps:1000,feeMinor:1000,holdDays:0,sellerUserId:sellerId,merchantName:originalName,merchantSupport:support,merchantContactId:seller!.id,providerAccountId:"acct_OriginalCommercial"});
 const [payment]=await db().insert(payments).values({invoiceId:invoice!.id,provider:"stripe",providerCheckoutRef:"cs_OriginalCommercial",idempotencyKey:"synthetic-commercial-payment",requestHash:createHash("sha256").update("synthetic-commercial-payment").digest("hex"),status:"processing",method:"hosted_checkout",currency:"CAD",amountMinor:10000,createdAt:now}).returning();
 await db().insert(paymentMerchantRoutes).values({paymentId:payment!.id,providerAccountId:"acct_OriginalCommercial",applicationFeeMinor:1000});
 const buyerSession=await db().transaction(tx=>createSession(tx,CUSTOMER.userId)),sellerSession=await db().transaction(tx=>createSession(tx,sellerId));
 return{invoice:invoice!,payment:payment!,sellerId,sellerContactId:seller!.id,buyerSession:buyerSession.token,sellerSession:sellerSession.token};
}
async function publicDocument(page:Page,sellerId:string,sellerContactId:string){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
 const html=await page.content();for(const privateValue of["acct_OriginalCommercial",sellerId,sellerContactId,"merchantContactId","providerAccountId","siteFeeBps","private-merchant@example.test"])expect(html).not.toContain(privateValue);
}
test.describe("original public commercial identity (C12.38)",()=>{
 test.afterAll(closeDb);
 for(const locale of["en","es","fr","ar"]as const){
  test(`${locale}: original invoice support and current seller preview stay distinct`,async({browser})=>{
   const seeded=await fixture(locale),context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}}),page=await context.newPage();
   try{
    await context.addCookies([{name:SESSION_COOKIE,value:seeded.buyerSession,url:C11_BASE_URL}]);
    for(const theme of["light","dark"]){
     await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.goto(`/portal/invoices/${seeded.invoice.id}`);
     const header=page.locator("main#main > header");await expect(header.getByText(originalName,{exact:true})).toBeVisible();
     await expect(page.getByRole("link",{name:support.email,exact:true})).toBeVisible();
     await expect(page.getByRole("link",{name:support.phone,exact:true}).locator("bdi")).toHaveAttribute("dir","ltr");
     await expect(page.locator("html")).toHaveAttribute("lang",locale);if(locale==="ar")await expect(page.locator("html")).toHaveAttribute("dir","rtl");
     await page.getByRole("link",{name:support.email,exact:true}).focus();await page.keyboard.press("Tab");await expect(page.getByRole("link",{name:support.phone,exact:true})).toBeFocused();
     await publicDocument(page,seeded.sellerId,seeded.sellerContactId);
     await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-original-business.png`),fullPage:true});
    }
    await db().update(businessProfile).set({name:"Replacement Platform"}).where(eq(businessProfile.id,1));
    await db().update(memberPayoutAccounts).set({merchantName:"Replacement Studio",merchantSupport:replacement,externalAccountId:"acct_ReplacementCommercial"}).where(eq(memberPayoutAccounts.userId,seeded.sellerId));
    await page.reload();await expect(page.getByRole("link",{name:support.email,exact:true})).toBeVisible();await expect(page.locator("main#main > header")).not.toContainText("Replacement");
    await context.clearCookies();await context.addCookies([{name:SESSION_COOKIE,value:seeded.sellerSession,url:C11_BASE_URL}]);await page.goto("/portal/payouts");
    await expect(page.getByRole("heading",{name:messages[locale]["members.payouts.businessDetails"],exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:replacement.email,exact:true})).toBeVisible();await expect(page.getByText("Replacement Studio",{exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:support.email,exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
   }finally{await context.close();}
  });
  test(`${locale}: pending receipt stays truthful and never becomes platform-branded after supplier removal`,async({browser})=>{
   const seeded=await fixture(locale),context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}}),page=await context.newPage(),token=paymentReturnToken(seeded.payment);
   const path=`/portal/invoices/confirmation/${token}`;
   try{
    for(const theme of["light","dark"]){
     await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.goto(path);
     await expect(page.getByText(originalName,{exact:true})).toBeVisible();await expect(page.getByRole("link",{name:support.email,exact:true})).toBeVisible();
     await expect(page.getByText(messages[locale]["customerInvoice.pending"],{exact:true})).toBeVisible();
     await publicDocument(page,seeded.sellerId,seeded.sellerContactId);
     await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-original-receipt.png`),fullPage:true});
    }
    // A real confirmation action with an unconfigured provider cannot invent success.
    await page.getByRole("button",{name:messages[locale]["customerInvoice.confirm"],exact:true}).focus();await page.keyboard.press("Enter");
    await expect(page.getByText(messages[locale]["customerInvoice.failed"],{exact:true})).toBeVisible();
    expect((await db().select().from(payments).where(eq(payments.id,seeded.payment.id)))[0]?.status).toBe("processing");
    expect((await db().select().from(invoices).where(eq(invoices.id,seeded.invoice.id)))[0]?.paidMinor).toBe(0);
    // Already-erased snapshot fixture for presentation; native tests exercise actual erasure.
    await db().update(invoiceMarketPolicies).set({merchantName:ERASED_MERCHANT_NAME,merchantSupport:null}).where(eq(invoiceMarketPolicies.invoiceId,seeded.invoice.id));
    await page.goto(path);await expect(page.getByText(messages[locale]["customerInvoice.merchantUnavailable"],{exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:support.email,exact:true})).toHaveCount(0);await expect(page.locator("main#main")).not.toContainText("Current Platform");
    await page.goto(`/portal/invoices/confirmation/${token.slice(0,-1)}x`);
    await expect(page.getByRole("heading",{name:messages[locale]["notFound.title"],exact:true})).toBeVisible();expect(await page.content()).not.toContain(support.email);
   }finally{await context.close();}
  });
 }
});
