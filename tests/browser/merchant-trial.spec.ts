// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: an existing trial selects only its original merchant's verified card.
// Provider setup is seeded; live Stripe acceptance remains C11.05/C12.26.
import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { contacts } from "@/core/contacts/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { businessProfile } from "@/core/settings/schema";
import { products, productVariants, priceLists, priceListEntries } from "@/modules/catalog/schema";
import { paymentMethods, paymentProviderCustomers } from "@/modules/invoicing/schema";
import { memberPayoutAccounts, memberProfiles, memberSettings } from "@/modules/members/schema";
import { plans, subscriptions, subscriptionEvents, subscriptionMarketPolicies, subscriptionCardSetups } from "@/modules/subscriptions/schema";
import { setupRequest } from "@/modules/subscriptions/card-setup";
import { C11_BASE_URL, seedC11Owner } from "./owner-session";

test.describe("original merchant trial cards (C12.38)", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);

  for (const locale of ["en","es","fr","ar"] as const) {
    test(`${locale}: original-account card only, keyboard, 320px and both themes`, async ({browser}) => {
      await seedC11Owner("Merchant trial proof");
      await db().update(businessProfile).set({enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
      const sellerId=randomUUID(),buyerId=randomUUID(),contactId=randomUUID(),productId=randomUUID(),variantId=randomUUID(),planId=randomUUID(),subscriptionId=randomUUID();
      const now=new Date();
      await db().insert(users).values([
        {id:sellerId,email:"merchant@example.test",role:"customer"},
        {id:buyerId,email:"trial-buyer@example.test",role:"customer"},
      ]);
      await db().insert(contacts).values([
        {id:contactId,userId:buyerId,name:"Trial buyer",email:"trial-buyer@example.test"},
        {userId:sellerId,name:"Merchant",email:"merchant@example.test"},
      ]);
      await db().insert(memberProfiles).values({userId:sellerId,handle:"trial_merchant",displayName:"Studio Rae",status:"active",ageAttestedAt:now});
      // The site has switched back to platform collection. This existing
      // agreement must retain the original connected merchant and Stripe.
      await db().insert(memberSettings).values({id:1,marketplaceEnabled:true,payoutModel:"hold",payoutAdapter:"manual"});
      await db().insert(memberPayoutAccounts).values({userId:sellerId,adapter:"stripe_connect",status:"ready",externalAccountId:"acct_TrialOriginal",chargesReady:true,merchantName:"Studio Rae"});
      await db().insert(products).values({id:productId,sellerUserId:sellerId,name:"Studio Rae membership",slug:"merchant-trial",kind:"digital",status:"active",visibility:"public",publishedAt:now});
      await db().insert(productVariants).values({id:variantId,productId,combinationKey:"default",sku:"merchant-trial",isDefault:true});
      const [priceList]=await db().insert(priceLists).values({name:"Merchant trial CAD",currency:"CAD",active:true}).returning();
      await db().insert(priceListEntries).values({priceListId:priceList!.id,variantId,amountMinor:1000});
      await db().insert(plans).values({id:planId,productId,name:"Studio Rae membership",interval:"month",trialDays:14,trialRequiresCard:true,billingMode:"platform",status:"active"});
      await db().insert(subscriptions).values({id:subscriptionId,contactId,planId,productVariantId:variantId,currency:"CAD",billingMode:"platform",provider:"stripe",status:"paused",signupPending:true,currentPeriodStart:now,currentPeriodEnd:new Date(now.getTime()+86_400_000)});
      await db().insert(subscriptionMarketPolicies).values({subscriptionId,model:"seller_merchant",adapter:"stripe_connect",siteFeeBps:1000,holdDays:0,sellerUserId:sellerId,merchantName:"Studio Rae",providerAccountId:"acct_TrialOriginal"});
      const setupAt=new Date(),savedAt=new Date(Date.now()+1);
      await db().insert(subscriptionEvents).values({subscriptionId,kind:"card_setup",detail:"cus_trial_original",at:setupAt});
      const [original]=await db().insert(paymentMethods).values({contactId,provider:"stripe",providerAccountId:"acct_TrialOriginal",providerMethodRef:"pm_trial_original",providerCustomerRef:"cus_trial_original",kind:"card",label:"Visa ending 4242",consentSource:"provider_checkout",consentedAt:savedAt,providerStatusAt:savedAt,createdAt:savedAt}).returning();
      for (const [account,suffix,label] of [["acct_TrialOriginal","original","Visa ending 4242"],["acct_TrialOther","other","Other merchant card"],["","platform","Platform card"]] as const) {
        await db().insert(paymentProviderCustomers).values({contactId,provider:"stripe",providerAccountId:account,providerCustomerRef:`cus_trial_${suffix}`});
        if(suffix!=="original") await db().insert(paymentMethods).values({contactId,provider:"stripe",providerAccountId:account,providerMethodRef:`pm_trial_${suffix}`,providerCustomerRef:`cus_trial_${suffix}`,kind:"card",label,consentSource:"provider_checkout",consentedAt:savedAt,providerStatusAt:savedAt,createdAt:savedAt});
      }
      // This account-selection fixture starts after exact signed setup proof.
      // A legacy card_setup timestamp and a fresh method alone grant no trial.
      const attemptId=randomUUID();
      const request=setupRequest.parse({setupAttemptId:attemptId,subscriptionId,contactId,currency:"CAD",providerAccountId:"acct_TrialOriginal",customer:{email:"trial-buyer@example.test",name:"Trial buyer"},successUrl:`${C11_BASE_URL}/memberships/trial-return?subscription=${subscriptionId}`,cancelUrl:`${C11_BASE_URL}/memberships`,idempotencyKey:`trial-card:${subscriptionId}:${attemptId}`});
      await db().insert(subscriptionCardSetups).values({id:attemptId,subscriptionId,provider:"stripe",providerAccountId:"acct_TrialOriginal",request,requestHash:createHash("sha256").update(JSON.stringify(request)).digest("hex"),providerCustomerRef:"cus_trial_original",providerCheckoutRef:"cs_TrialOriginal",providerSetupIntentRef:"seti_TrialOriginal",confirmedMethodId:original!.id,confirmedAt:savedAt});
      const buyer=await db().transaction(tx=>createSession(tx,buyerId));
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
      await context.addCookies([{name:SESSION_COOKIE,value:buyer.token,url:C11_BASE_URL}]);
      const page=await context.newPage();
      await page.goto(`${locale==="en"?"":`/${locale}`}/memberships/trial-return?subscription=${subscriptionId}`);
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
      if(locale==="ar") await expect(page.locator("html")).toHaveAttribute("dir","rtl");
      const select=page.locator("#trial-method");
      await expect(select).toHaveValue(original!.id);
      expect(await select.locator("option").allTextContents()).toEqual(["Visa ending 4242"]);
      for(const theme of ["light","dark"]) {
        await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
        expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
        expect(await page.content()).not.toContain("acct_TrialOriginal");
        expect(await page.content()).not.toContain("cus_trial_original");
        await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-trial.png`),fullPage:true});
      }
      await select.focus();
      await page.keyboard.press("Tab");
      const submit=page.locator("form").filter({has:select}).getByRole("button");
      await expect(submit).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/portal/subscriptions/${subscriptionId}$`));
      const [started]=await db().select().from(subscriptions).where(eq(subscriptions.id,subscriptionId));
      expect(started).toMatchObject({status:"trialing",signupPending:false,provider:"stripe",paymentMethodId:original!.id});
      await context.close();
      const seller=await db().transaction(tx=>createSession(tx,sellerId));
      const wrong=await browser.newContext({baseURL:C11_BASE_URL});
      await wrong.addCookies([{name:SESSION_COOKIE,value:seller.token,url:C11_BASE_URL}]);
      const denied=await wrong.newPage();
      expect((await denied.goto(`/memberships/trial-return?subscription=${subscriptionId}`))?.status()).toBe(404);
      expect(await denied.content()).not.toContain("Visa ending 4242");
      await wrong.close();
    });
  }
});
