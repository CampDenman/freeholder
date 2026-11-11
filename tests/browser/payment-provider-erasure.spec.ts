// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: real owner erasure stages durable provider work in four locales.
// Provider data is synthetic; this does not claim live Stripe acceptance.
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {eq} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {contacts} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {dataRequests,dataRequestArtifacts} from "@/core/privacy/schema";
import {paymentProviderCustomers} from "@/modules/invoicing/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";
const messages={en,es,fr,ar};
test.describe("payment-provider erasure (C1.08/C12.38)",()=>{
 test.setTimeout(180000);test.afterAll(closeDb);
 for(const locale of ["en","es","fr","ar"] as const){
  test(`${locale}: explains billing consequences and waits for actual provider cleanup at320px`,async({browser})=>{
   const token=await seedC11Owner("Provider privacy proof");
   await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
   const [contact]=await db().insert(contacts).values({name:"Synthetic payment customer",email:"provider-browser@example.test"}).returning();
   await db().insert(paymentProviderCustomers).values({contactId:contact!.id,provider:"stripe",providerAccountId:"acct_original",providerCustomerRef:"cus_original"});
   const [request]=await db().insert(dataRequests).values({contactId:contact!.id,kind:"erasure",status:"verified",requestedBy:"owner",details:{kind:"erasure"},verifiedAt:new Date(),verificationMethod:"Synthetic browser identity",responseDueAt:new Date(Date.now()+86400000)}).returning();
   const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
   await useOwnerSession(context,token);const page=await context.newPage();
   try{
    await page.goto(`/admin/contacts/privacy/${request!.id}`);
    await expect(page.locator("html")).toHaveAttribute("lang",locale);
    if(locale==="ar")await expect(page.locator("html")).toHaveAttribute("dir","rtl");
    await expect(page.getByText(messages[locale]["privacy.fulfill.confirmationHint"],{exact:true})).toBeVisible();
    await expect(page.getByText(messages[locale]["privacy.fulfill.erasureHint"],{exact:true})).toBeVisible();
    for(const theme of ["light","dark"]){
     await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.reload();
     expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
     await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-provider-erasure-confirm.png`),fullPage:true});
    }
    const confirmation=page.getByLabel(messages[locale]["privacy.fulfill.confirmation"],{exact:true});
    await confirmation.focus();await confirmation.pressSequentially("ERASE");await page.keyboard.press("Tab");
    await expect(page.getByRole("button",{name:messages[locale]["privacy.fulfill.submit"],exact:true})).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading",{name:messages[locale]["privacy.erasure.pending.title"],exact:true})).toBeVisible();
    await expect(page.getByText(messages[locale]["privacy.erasure.pending.hint"],{exact:true})).toBeVisible();
    await expect(page.getByText(messages[locale]["privacy.system.identityBeforeErasure"],{exact:true})).toBeVisible();
    await expect(page.getByText(messages[locale]["privacy.system.providerPending"],{exact:true})).toBeVisible();
    await expect(page.locator('input[name="confirmation"]')).toHaveCount(0);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request!.id)))[0]!.status).toBe("in_progress");
    expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
    const [artifact]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,request!.id));
    const body=artifact!.body as {outcomes:Array<{scope:string;outcome:string;pendingJobs?:string[]}>};
    expect(body.outcomes.find(outcome=>outcome.scope==="commerce.money")).toMatchObject({outcome:"pending",pendingJobs:[expect.any(String)]});
    expect(JSON.stringify(body)).not.toContain("cus_original");expect(JSON.stringify(body)).not.toContain("acct_original");
    for(const theme of ["light","dark"]){
     await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.reload();
     expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
     await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-provider-erasure-pending.png`),fullPage:true});
    }
   }finally{await context.close();}
  });
 }
});
