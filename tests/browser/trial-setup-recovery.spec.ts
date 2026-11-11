// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual owner/customer UI with synthetic durable provider-state fixtures.
// Signed provider HTTP and callback bindings are qualified in the native suites;
// these browser fixtures do not supply live provider acceptance.
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
import {products,productVariants} from "@/modules/catalog/schema";
import {paymentMethods} from "@/modules/invoicing/schema";
import {plans,subscriptionCardSetups,subscriptionSetupDispatches,subscriptions} from "@/modules/subscriptions/schema";
import {setupRequest} from "@/modules/subscriptions/card-setup";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";

const messages={en,es,fr,ar};
async function fixture(locale:keyof typeof messages,kind:"unknown"|"customer"){
 const owner=await seedC11Owner("Card setup recovery");
 await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
 const buyerId=randomUUID();
 await db().insert(users).values({id:buyerId,email:"setup-buyer@example.test",role:"customer"});
 const [contact]=await db().insert(contacts).values({userId:buyerId,name:"Synthetic setup buyer",email:"setup-buyer@example.test"}).returning();
 const [product]=await db().insert(products).values({name:"Original trial membership",slug:"original-trial-membership",kind:"digital",status:"active",publishedAt:new Date()}).returning();
 const [variant]=await db().insert(productVariants).values({productId:product!.id,combinationKey:"default",sku:"setup-membership",isDefault:true}).returning();
 const [plan]=await db().insert(plans).values({productId:product!.id,name:"Original trial membership",interval:"month",trialDays:14,trialRequiresCard:true,billingMode:"platform",status:"active"}).returning();
 const now=new Date(),end=new Date(now.getTime()+14*86400000);
 const [sub]=await db().insert(subscriptions).values({contactId:contact!.id,planId:plan!.id,productVariantId:variant!.id,currency:"CAD",billingMode:"platform",provider:"stripe",status:"paused",signupPending:true,currentPeriodStart:now,currentPeriodEnd:end,pausedAt:now}).returning();
 const attemptId=randomUUID();
 const original=setupRequest.parse({setupAttemptId:attemptId,subscriptionId:sub!.id,contactId:contact!.id,currency:"CAD",...(kind==="unknown"?{providerAccountId:"acct_original"}:{}),customer:{email:contact!.email,name:contact!.name},successUrl:`${C11_BASE_URL}/memberships/trial-return?subscription=${sub!.id}`,cancelUrl:`${C11_BASE_URL}/memberships`,idempotencyKey:`trial-card:${sub!.id}:${attemptId}`});
 const hash=createHash("sha256").update(JSON.stringify(original)).digest("hex");
 await db().insert(subscriptionCardSetups).values({id:attemptId,subscriptionId:sub!.id,provider:"stripe",providerAccountId:kind==="unknown"?"acct_original":"",request:original,requestHash:hash,...(kind==="customer"?{providerCustomerRef:"cus_BrowserOriginal",providerCheckoutRef:"cs_BrowserOriginal"}:{})});
 let dispatchId:string|undefined;
 if(kind==="unknown"){
  const [dispatch]=await db().insert(subscriptionSetupDispatches).values({setupId:attemptId,kind:"customer",state:"unknown",requestHash:hash,initiatedBy:`user:${buyerId}`,finishedAt:now}).returning();
  dispatchId=dispatch!.id;
 }else await db().insert(paymentMethods).values({contactId:contact!.id,provider:"stripe",providerMethodRef:"pm_UnrelatedFresh",providerCustomerRef:"cus_BrowserOriginal",kind:"card",label:"Unrelated fresh card",consentSource:"provider_checkout",consentedAt:now,providerStatusAt:now});
 const buyer=await db().transaction(tx=>createSession(tx,buyerId));
 return {owner,buyer:buyer.token,contactId:contact!.id,subscriptionId:sub!.id,attemptId,dispatchId};
}

test.describe("trial setup recovery (C12.38)",()=>{
 test.setTimeout(180000);test.afterAll(closeDb);
 for(const locale of ["en","es","fr","ar"] as const){
  test(`${locale}: records exact owner evidence with keyboard access at320px`,async({browser})=>{
   const source=await fixture(locale,"unknown"),text=messages[locale];
   const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
   await useOwnerSession(context,source.owner);const page=await context.newPage();
   try{
    await page.goto("/admin/subscriptions");
    await page.getByRole("link",{name:"Original trial membership",exact:true}).click();
    await expect(page.getByRole("heading",{name:text["subscriptions.setup.title"],exact:true})).toBeVisible();
    await expect(page.getByText("acct_original",{exact:false})).toBeVisible();
    await expect(page.getByText(text["subscriptions.setup.evidenceHint"],{exact:true})).toBeVisible();
    if(locale==="ar")await expect(page.locator("html")).toHaveAttribute("dir","rtl");
    for(const theme of ["light","dark"]){
     await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.reload();
     expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
     await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-setup-recovery.png`),fullPage:true});
    }
    await page.getByRole("radio",{name:text["subscriptions.setup.cancelled"],exact:true}).check();
    await page.getByLabel(text["subscriptions.setup.operation"],{exact:true}).fill("synthetic-provider-support-case-123");
    await page.getByLabel(text["subscriptions.setup.providerEvidence"],{exact:true}).fill("Synthetic original-account support record guarantees this exact operation was cancelled and cannot complete later.");
    await page.getByLabel(text["subscriptions.setup.callerEvidence"],{exact:true}).fill("Synthetic original caller and every retry stopped before the provider issued its final cancellation guarantee.");
    const confirmation=page.getByLabel(text["subscriptions.setup.confirm"],{exact:true});
    await confirmation.focus();await confirmation.pressSequentially("PROVIDER OUTCOME CONFIRMED");await page.keyboard.press("Tab");
    await expect(page.getByRole("button",{name:text["subscriptions.setup.submit"],exact:true})).toBeFocused();await page.keyboard.press("Enter");
    await expect(page.getByText(text["subscriptions.setup.saved"],{exact:true})).toBeVisible();
    await expect(page.getByText(text["subscriptions.setup.state.provider_cancelled"],{exact:true})).toBeVisible();
    expect((await db().select().from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.id,source.dispatchId!)))[0]).toMatchObject({state:"provider_cancelled",resolution:{source:"human_provider_confirmation",providerOperationRef:"synthetic-provider-support-case-123"}});
    expect((await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,source.attemptId)))[0]!.closedReason).toBe("provider_cancelled");
   }finally{await context.close();}
  });

  test(`${locale}: waits for exact setup proof and starts only the matching customer card`,async({browser})=>{
   const source=await fixture(locale,"customer"),text=messages[locale];
   const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
   await context.addCookies([{name:SESSION_COOKIE,value:source.buyer,url:C11_BASE_URL}]);const page=await context.newPage();
   try{
    const path=`/memberships/trial-return?subscription=${source.subscriptionId}`;
    await page.goto(path);
    await expect(page.getByText(text["memberships.cardWaiting"],{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:text["memberships.startTrial"],exact:true})).toHaveCount(0);
    const now=new Date();
    const [verified]=await db().insert(paymentMethods).values({contactId:source.contactId,provider:"stripe",providerMethodRef:"pm_ExactBrowserSetup",providerCustomerRef:"cus_BrowserOriginal",kind:"card",label:"Exact setup card ending4242",consentSource:"provider_checkout",consentedAt:now,providerStatusAt:now}).returning();
    // Install the signed-provider final-state fixture. The actual signature,
    // original-account retrieval and exact metadata path have native controls.
    await db().update(subscriptionCardSetups).set({providerSetupIntentRef:"seti_ExactBrowserSetup",confirmedMethodId:verified!.id,confirmedAt:now}).where(eq(subscriptionCardSetups.id,source.attemptId));
    await page.reload();
    await expect(page.getByRole("option",{name:"Exact setup card ending4242",exact:true})).toHaveCount(1);
    await expect(page.getByRole("option",{name:"Unrelated fresh card",exact:true})).toHaveCount(0);
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button",{name:text["memberships.startTrial"],exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/portal/subscriptions/${source.subscriptionId}$`));
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id,source.subscriptionId)))[0]).toMatchObject({signupPending:false,status:"trialing",paymentMethodId:verified!.id});
   }finally{await context.close();}
  });
 }
});
