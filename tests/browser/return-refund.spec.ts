// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C11.10: a human records an already returned offline refund.
// Payments are seeded; this does not prove live-provider acceptance.
import {createHash,randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {eq} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {contacts} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import {orders,orderItems,products,productVariants,returnRequests,returnItems} from "@/modules/catalog/schema";
import {creditNotes,creditNoteLines,invoices,invoiceLines,payments,refunds} from "@/modules/invoicing/schema";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";

async function seedReturn(locale:string,provider:"manual"|"stripe"="manual") {
      const token=await seedC11Owner("Returns proof");
      await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
      const now=new Date(),contactId=randomUUID(),orderId=randomUUID(),invoiceId=randomUUID(),productId=randomUUID(),variantId=randomUUID(),lineId=randomUUID(),returnId=randomUUID();
      await db().insert(contacts).values({id:contactId,name:"Return buyer",email:"return-buyer@example.test"});
      await db().insert(products).values({id:productId,name:"Returned print",slug:"returned-print",kind:"physical"});
      await db().insert(productVariants).values({id:variantId,productId,combinationKey:"default",sku:"return-print",isDefault:true});
      await db().insert(invoices).values({id:invoiceId,contactId,number:"INV-RETURN",sourceType:"order",sourceId:orderId,idempotencyKey:`invoice-${orderId}`,requestHash:"a".repeat(64),status:"paid",currency:"CAD",subtotalMinor:1_000,totalMinor:1_000,paidMinor:1_000,issuedAt:now,paidAt:now});
      await db().insert(orders).values({id:orderId,contactId,invoiceId,currency:"CAD",status:"paid",subtotalMinor:1_000,totalMinor:1_000});
      await db().insert(invoiceLines).values({invoiceId,position:0,sourceType:"variant",sourceId:variantId,description:"Returned print",quantityMicros:1_000_000,unitAmountMinor:1_000,subtotalMinor:1_000,totalMinor:1_000});
      await db().insert(orderItems).values({id:lineId,orderId,variantId,quantity:1,unitAmountMinor:1_000,lineTotalMinor:1_000});
      for(const [index,amount] of [400,600].entries()) await db().insert(payments).values({invoiceId,provider,method:provider==="manual" ? "cash" : "hosted_checkout",providerRef:`${provider}:fixture:${index}`,idempotencyKey:`fixture-payment-${index}`,requestHash:"b".repeat(64),status:"succeeded",currency:"CAD",amountMinor:amount,processedAt:now});
      await db().insert(returnRequests).values({id:returnId,orderId,contactId,status:"received",reason:"Damaged print",restock:false});
      await db().insert(returnItems).values({returnId,orderItemId:lineId,quantity:1});
      if(provider==="stripe"){
        const [line]=await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId,invoiceId));
        const [credit]=await db().insert(creditNotes).values({invoiceId,idempotencyKey:`return:${returnId}:credit`,requestHash:"c".repeat(64),currency:"CAD",reason:"Damaged print",subtotalMinor:1000,totalMinor:1000}).returning();
        await db().insert(creditNoteLines).values({creditNoteId:credit!.id,invoiceLineId:line!.id,position:0,description:"Returned print",quantityMicros:1_000_000,subtotalMinor:1000,totalMinor:1000});
        let firstRefundId:string|undefined;
        for(const payment of await db().select().from(payments).where(eq(payments.invoiceId,invoiceId))){
          const request={paymentId:payment.id,amountMinor:payment.amountMinor,reason:"Damaged print",idempotencyKey:`return:${returnId}:provider:fixture:${payment.id}`,provider:"stripe"};
          const requestHash=createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(request).sort(([a],[b])=>a.localeCompare(b))))).digest("hex");
          const [refund]=await db().insert(refunds).values({...request,requestHash,invoiceId,currency:"CAD",status:"processing",providerRef:`re_fixture_${payment.id}`}).returning();
          firstRefundId ??= refund!.id;
        }
        await db().update(returnRequests).set({creditNoteId:credit!.id,refundId:firstRefundId}).where(eq(returnRequests.id,returnId));
      }
      return {token,returnId,invoiceId};
}

test.describe("attested offline return refund (C5.19)",()=>{
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for(const locale of ["en","es","fr","ar"] as const) {
    test(`${locale}: requires confirmation, records all installments and supports both themes at 320px`,async({browser})=>{
      const {token,returnId,invoiceId}=await seedReturn(locale);
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
      await useOwnerSession(context,token);
      const page=await context.newPage();
      await page.goto(`/admin/returns?id=${returnId}`);
      const form=page.locator("form").filter({has:page.locator('input[name="intent"][value="refundReturn"]')});
      const confirm=form.locator('input[name="offlineRefundConfirmed"]');
      await expect(confirm).toBeVisible();
      await expect(confirm).not.toBeChecked();
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
      if(locale==="ar") await expect(page.locator("html")).toHaveAttribute("dir","rtl");
      for(const theme of ["light","dark"]) {
        await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
        expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
        await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-return.png`),fullPage:true});
      }
      await form.getByRole("button").click();
      expect(await confirm.evaluate((element:HTMLInputElement)=>element.validity.valueMissing)).toBe(true);
      expect(await db().select().from(refunds)).toHaveLength(0);
      await confirm.focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("Tab");
      await expect(form.getByRole("button")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/saved=refundReturn/);
      await expect(confirm).toHaveCount(0);
      const [returned]=await db().select().from(returnRequests).where(eq(returnRequests.id,returnId));
      expect(returned?.status).toBe("refunded");
      const recorded=await db().select().from(refunds).where(eq(refunds.invoiceId,invoiceId));
      expect(recorded).toHaveLength(2);
      expect(recorded.every(refund=>refund.status==="succeeded" && refund.provider==="manual")).toBe(true);
      expect(recorded.reduce((sum,refund)=>sum+refund.amountMinor,0)).toBe(1_000);
      await context.close();
    });
    test(`${locale}: keeps provider returns open until every original installment confirms`,async({browser})=>{
      const {token,returnId,invoiceId}=await seedReturn(locale,"stripe");
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
      await useOwnerSession(context,token);
      const page=await context.newPage();
      await page.goto(`/admin/returns?id=${returnId}`);
      const form=page.locator("form").filter({has:page.locator('input[name="intent"][value="submitReturnProviderRefund"]')});
      await expect(form.getByRole("button")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
      if(locale==="ar") await expect(page.locator("html")).toHaveAttribute("dir","rtl");
      for(const theme of ["light","dark"]){
        await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);
        await page.reload();
        expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
        expect(await page.content()).not.toContain("re_fixture_");
        await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-provider-return.png`),fullPage:true});
      }
      await form.getByRole("button").focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/saved=submitReturnProviderRefund/);
      expect((await db().select().from(returnRequests).where(eq(returnRequests.id,returnId)))[0]!.status).toBe("received");
      const assigned=await db().select().from(refunds).where(eq(refunds.invoiceId,invoiceId));
      expect(assigned).toHaveLength(2);
      expect(assigned.every(refund=>refund.status==="processing")).toBe(true);
      async function confirm(index:number){
        const refund=assigned[index]!;
        await db().update(refunds).set({status:"succeeded",processedAt:new Date()}).where(eq(refunds.id,refund.id));
        await db().update(payments).set({refundedMinor:refund.amountMinor}).where(eq(payments.id,refund.paymentId));
        const confirmed=assigned.slice(0,index+1).reduce((sum,row)=>sum+row.amountMinor,0);
        await db().update(invoices).set({refundedMinor:confirmed,...(confirmed===1000 ? {status:"refunded" as const}:{})}).where(eq(invoices.id,invoiceId));
        await page.goto(`/admin/returns?id=${returnId}`);
        await form.getByRole("button").focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/saved=submitReturnProviderRefund/);
      }
      await confirm(0);
      await expect(form.getByRole("button")).toBeVisible();
      await confirm(1);
      await expect(form).toHaveCount(0);
      expect((await db().select().from(returnRequests).where(eq(returnRequests.id,returnId)))[0]!.status).toBe("refunded");
      expect((await db().select().from(invoices).where(eq(invoices.id,invoiceId)))[0]!.refundedMinor).toBe(1000);
      expect((await db().select().from(creditNotes).where(eq(creditNotes.invoiceId,invoiceId)))[0]!.status).toBe("issued");
      await context.close();
    });
  }
});
