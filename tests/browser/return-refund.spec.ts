// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C11.10: a human records an already returned offline refund.
// Payments are seeded; this does not prove live-provider acceptance.
import {createHash,randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {eq,sql} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createSession,SESSION_COOKIE} from "@/core/auth/sessions";
import {contacts} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import {orders,orderItems,products,productVariants,returnRequests,returnItems} from "@/modules/catalog/schema";
import {creditNotes,creditNoteLines,invoices,invoiceLines,payments,refunds} from "@/modules/invoicing/schema";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";

async function seedReturn(locale:string,provider:"manual"|"stripe"|"mixed"="manual") {
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
      for(const [index,amount] of [400,600].entries()){
        const originalProvider=provider==="mixed" ? (index===0?"manual":"stripe") : provider;
        await db().insert(payments).values({invoiceId,provider:originalProvider,method:originalProvider==="manual" ? "cash" : "hosted_checkout",providerRef:`${originalProvider}:fixture:${index}`,idempotencyKey:`fixture-payment-${index}`,requestHash:"b".repeat(64),status:"succeeded",currency:"CAD",amountMinor:amount,processedAt:now});
      }
      await db().insert(returnRequests).values({id:returnId,orderId,contactId,status:"received",reason:"Damaged print",restock:false});
      await db().insert(returnItems).values({returnId,orderItemId:lineId,quantity:1});
      if(provider!=="manual"){
        const [line]=await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId,invoiceId));
        const [credit]=await db().insert(creditNotes).values({invoiceId,idempotencyKey:`return:${returnId}:credit`,requestHash:"c".repeat(64),currency:"CAD",reason:"Damaged print",subtotalMinor:1000,totalMinor:1000}).returning();
        await db().insert(creditNoteLines).values({creditNoteId:credit!.id,invoiceLineId:line!.id,position:0,description:"Returned print",quantityMicros:1_000_000,subtotalMinor:1000,totalMinor:1000});
        let firstRefundId:string|undefined;
        for(const payment of await db().select().from(payments).where(eq(payments.invoiceId,invoiceId))){
          const request={paymentId:payment.id,amountMinor:payment.amountMinor,reason:"Damaged print",idempotencyKey:`return:${returnId}:provider:fixture:${payment.id}`,provider:payment.provider};
          const requestHash=createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(request).sort(([a],[b])=>a.localeCompare(b))))).digest("hex");
          const [refund]=await db().insert(refunds).values({...request,requestHash,invoiceId,currency:"CAD",status:payment.provider==="manual"?"created":"processing",providerRef:payment.provider==="manual"?null:`re_fixture_${payment.id}`}).returning();
          firstRefundId ??= refund!.id;
        }
        await db().update(returnRequests).set({creditNoteId:credit!.id,refundId:firstRefundId}).where(eq(returnRequests.id,returnId));
      }
      return {token,returnId,invoiceId,orderId,contactId,lineId};
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
      await page.locator('form:has(input[name="intent"][value="prepareReturnRefund"]) button').click();
      await expect(page).toHaveURL(/saved=prepareReturnRefund/);
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
      expect((await db().select().from(refunds)).every(refund=>refund.status==="created")).toBe(true);
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
    test(`${locale}: a customer requests their own return and follows the owner decision at 320px`,async({browser})=>{
      const {token,returnId,orderId,contactId,invoiceId}=await seedReturn(locale);
      await db().delete(returnRequests).where(eq(returnRequests.id,returnId));
      const userId=randomUUID();
      await db().insert(users).values({id:userId,email:"return-buyer@example.test",role:"customer"});
      await db().update(contacts).set({userId,preferredLocale:locale}).where(eq(contacts.id,contactId));
      const session=await db().transaction(tx=>createSession(tx,userId));
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
      await context.addCookies([{name:SESSION_COOKIE,value:session.token,url:C11_BASE_URL}]);
      const page=await context.newPage();
      await page.goto(`/portal/orders/${orderId}/returns`);
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
      for(const theme of ["light","dark"]){
        await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.reload();
        expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
        await page.screenshot({path:test.info().outputPath(`${locale}-${theme}-customer-return.png`),fullPage:true});
      }
      await page.locator('input[type="number"]').fill("1");
      await page.locator('textarea[name="reason"]').fill("The print arrived damaged");
      await page.locator('textarea[name="reason"]').focus();await page.keyboard.press("Tab");
      await expect(page.locator('form:has(input[name="orderId"]) button[type="submit"]')).toBeFocused();await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/saved=1/);
      const [requested]=await db().select().from(returnRequests).where(eq(returnRequests.orderId,orderId));
      expect(requested!.status).toBe("requested");
      const owner=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});await useOwnerSession(owner,token);
      const admin=await owner.newPage();await admin.goto(`/admin/returns?id=${requested!.id}`);
      for(const theme of ["light","dark"]){await owner.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await admin.reload();expect((await new AxeBuilder({page:admin}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);expect(await admin.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await admin.screenshot({path:test.info().outputPath(`${locale}-${theme}-owner-return-label.png`),fullPage:true});}
      await admin.locator('input[name="labelUrl"]').fill("https://labels.example.test/return-label");
      await admin.locator('form:has(input[name="decision"][value="approved"]) button').click();
      await expect(admin).toHaveURL(/saved=decideReturn/);
      await page.reload();
      await expect(page.locator("main section")).toContainText("The print arrived damaged");
      await expect(page.locator('a[href="https://labels.example.test/return-label"]')).toBeVisible();
      const result=await db().select().from(returnRequests).where(eq(returnRequests.id,requested!.id));expect(result[0]!.status).toBe("approved");
      await expect(admin.locator('input[name="restock"]')).not.toBeChecked();
      expect((await new AxeBuilder({page:admin}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
      await admin.locator('form:has(input[name="intent"][value="receiveReturn"]) button').click();
      await expect(admin).toHaveURL(/saved=receiveReturn/);
      await admin.locator('form:has(input[name="intent"][value="prepareReturnRefund"]) button').click();
      await expect(admin).toHaveURL(/saved=prepareReturnRefund/);
      await admin.locator('input[name="offlineRefundConfirmed"]').check();
      await admin.locator('form:has(input[name="intent"][value="refundReturn"]) button').click();
      await expect(admin).toHaveURL(/saved=refundReturn/);
      await page.reload();
      expect((await db().select().from(returnRequests).where(eq(returnRequests.id,requested!.id)))[0]!.status).toBe("refunded");
      expect((await db().select().from(creditNotes).where(eq(creditNotes.invoiceId,invoiceId)))[0]!.status).toBe("issued");
      expect(await page.content()).not.toMatch(/providerAccountId|applicationFeeMinor|providerRef/);
      await owner.close();await context.close();
    });
    test(`${locale}: records only the displayed offline portion and waits for the seeded online confirmation`,async({browser})=>{
      const {token,returnId,invoiceId}=await seedReturn(locale,"mixed");
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});await useOwnerSession(context,token);
      const page=await context.newPage();await page.goto(`/admin/returns?id=${returnId}`);
      await page.locator('form:has(input[name="intent"][value="prepareReturnRefund"]) button').click();await expect(page).toHaveURL(/saved=prepareReturnRefund/);
      const offline=page.locator('form:has(input[name="intent"][value="refundReturn"])');
      await expect(offline.locator('input[name="offlineRefundAmountMinor"]')).toHaveValue("400");
      for(const theme of ["light","dark"]){await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.reload();expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);}
      await offline.locator('input[name="offlineRefundConfirmed"]').focus();await page.keyboard.press("Space");await page.keyboard.press("Tab");await expect(offline.getByRole("button")).toBeFocused();await page.keyboard.press("Enter");await expect(page).toHaveURL(/saved=refundReturn/);
      expect((await db().select().from(returnRequests).where(eq(returnRequests.id,returnId)))[0]!.status).toBe("received");
      expect((await db().select().from(creditNotes).where(eq(creditNotes.invoiceId,invoiceId)))[0]!.status).toBe("draft");
      const rows=await db().select().from(refunds).where(eq(refunds.invoiceId,invoiceId));
      expect(rows.find(row=>row.provider==="manual")!.status).toBe("succeeded");const online=rows.find(row=>row.provider==="stripe")!;
      await db().transaction(async tx=>{await tx.execute(sql`select set_config('freeholder.confirmed_return_refund',${online.id},true)`);await tx.update(refunds).set({status:"succeeded",processedAt:new Date()}).where(eq(refunds.id,online.id));});
      await db().update(payments).set({refundedMinor:online.amountMinor}).where(eq(payments.id,online.paymentId));await db().update(invoices).set({refundedMinor:1000,status:"refunded"}).where(eq(invoices.id,invoiceId));
      await page.reload();await page.locator('form:has(input[name="intent"][value="submitReturnProviderRefund"]) button').click();await expect(page).toHaveURL(/saved=submitReturnProviderRefund/);
      expect((await db().select().from(returnRequests).where(eq(returnRequests.id,returnId)))[0]!.status).toBe("refunded");expect((await db().select().from(creditNotes).where(eq(creditNotes.invoiceId,invoiceId)))[0]!.status).toBe("issued");
      await context.close();
    });
    test(`${locale}: keeps provider returns open until every original installment confirms`,async({browser})=>{
      const {token,returnId,invoiceId}=await seedReturn(locale,"stripe");
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
      await useOwnerSession(context,token);
      const page=await context.newPage();
      await page.goto(`/admin/returns?id=${returnId}`);
      await page.locator('form:has(input[name="intent"][value="prepareReturnRefund"]) button').click();
      await expect(page).toHaveURL(/saved=prepareReturnRefund/);
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
        await db().transaction(async tx=>{
          // Synthetic provider ledger fixture only; actual signed feedback is covered by native integration tests.
          await tx.execute(sql`select set_config('freeholder.confirmed_return_refund',${refund.id},true)`);
          await tx.update(refunds).set({status:"succeeded",processedAt:new Date()}).where(eq(refunds.id,refund.id));
        });
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
