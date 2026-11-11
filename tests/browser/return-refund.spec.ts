// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C11.10: a human records an already returned offline refund.
// Payments are seeded; this does not prove live-provider acceptance.
import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {eq} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {contacts} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import {orders,orderItems,products,productVariants,returnRequests,returnItems} from "@/modules/catalog/schema";
import {invoices,payments,refunds} from "@/modules/invoicing/schema";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";

test.describe("attested offline return refund (C5.19)",()=>{
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for(const locale of ["en","es","fr","ar"] as const) {
    test(`${locale}: requires confirmation, records all installments and supports both themes at 320px`,async({browser})=>{
      const token=await seedC11Owner("Returns proof");
      await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
      const now=new Date(),contactId=randomUUID(),orderId=randomUUID(),invoiceId=randomUUID(),productId=randomUUID(),variantId=randomUUID(),lineId=randomUUID(),returnId=randomUUID();
      await db().insert(contacts).values({id:contactId,name:"Return buyer",email:"return-buyer@example.test"});
      await db().insert(products).values({id:productId,name:"Returned print",slug:"returned-print",kind:"physical"});
      await db().insert(productVariants).values({id:variantId,productId,combinationKey:"default",sku:"return-print",isDefault:true});
      await db().insert(invoices).values({id:invoiceId,contactId,number:"INV-RETURN",sourceType:"order",sourceId:orderId,idempotencyKey:`invoice-${orderId}`,requestHash:"a".repeat(64),status:"paid",currency:"CAD",subtotalMinor:1_000,totalMinor:1_000,paidMinor:1_000,issuedAt:now,paidAt:now});
      await db().insert(orders).values({id:orderId,contactId,invoiceId,currency:"CAD",status:"paid",subtotalMinor:1_000,totalMinor:1_000});
      await db().insert(orderItems).values({id:lineId,orderId,variantId,quantity:1,unitAmountMinor:1_000,lineTotalMinor:1_000});
      for(const [index,amount] of [400,600].entries()) await db().insert(payments).values({invoiceId,provider:"manual",method:"cash",providerRef:`manual:fixture:${index}`,idempotencyKey:`fixture-payment-${index}`,requestHash:"b".repeat(64),status:"succeeded",currency:"CAD",amountMinor:amount,processedAt:now});
      await db().insert(returnRequests).values({id:returnId,orderId,contactId,status:"received",reason:"Damaged print",restock:false});
      await db().insert(returnItems).values({returnId,orderItemId:lineId,quantity:1});
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
  }
});
