// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.16/C5.20: owner checkout uses the stock already held for the same cart.
import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {and,eq} from "drizzle-orm";
import {closeDb,db} from "@/core/db";
import {contacts} from "@/core/contacts/schema";
import {businessLocations} from "@/core/locations/schema";
import {businessProfile} from "@/core/settings/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import {cartItems,carts,inventoryItems,orders,priceListEntries,priceLists,products,productVariants,stockMovements,stockReservations} from "@/modules/catalog/schema";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";

test.describe("cart-owned stock checkout (C5.16/C5.20)",()=>{
  test.setTimeout(120_000);
  test.afterAll(closeDb);
  for(const locale of ["en","es","fr","ar"] as const){
    test(`${locale}: checks out every remaining reserved item with keyboard and both themes`,async({browser})=>{
      const token=await seedC11Owner("Reserved stock proof");
      await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
      const contactId=randomUUID(),locationId=randomUUID(),productId=randomUUID(),variantId=randomUUID(),listId=randomUUID(),itemId=randomUUID(),cartId=randomUUID();
      await db().insert(contacts).values({id:contactId,name:"Stock buyer",email:"stock-buyer@example.test"});
      await db().insert(businessLocations).values({id:locationId,name:"Stockroom",slug:"stockroom",country:"CA"});
      await db().insert(products).values({id:productId,name:"Reserved print",slug:"reserved-print",kind:"physical",status:"active",visibility:"public",publishedAt:new Date()});
      await db().insert(productVariants).values({id:variantId,productId,combinationKey:"default",sku:"reserved-print",isDefault:true,status:"active",requiresShipping:false});
      await db().insert(priceLists).values({id:listId,name:"Reserved retail",currency:"CAD",kind:"retail"});
      await db().insert(priceListEntries).values({priceListId:listId,variantId,amountMinor:1000});
      await db().insert(inventoryItems).values({id:itemId,variantId,locationId});
      await db().insert(stockMovements).values({inventoryItemId:itemId,delta:3,reason:"receipt",actor:"system"});
      await db().insert(carts).values({id:cartId,token:randomUUID(),contactId,currency:"CAD"});
      const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
      await useOwnerSession(context,token);
      const page=await context.newPage();
      await page.goto(`/admin/carts/${cartId}`);
      const add=page.locator("form").filter({has:page.locator('input[name="intent"][value="addCartItem"]')});
      await add.locator('select[name="variantId"]').selectOption(variantId);
      await add.locator('input[name="quantity"]').fill("3");
      await add.locator('select[name="locationId"]').selectOption(locationId);
      await add.getByRole("button").focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/saved=addCartItem/);
      const current=await context.request.get(`/api/v1/catalog.getCart?cartId=${cartId}`);
      expect(current.ok()).toBe(true);
      expect(await current.json()).toMatchObject({allAvailable:true,lines:[{quantity:3,stock:{available:true}}]});
      const publicStock=await context.request.get(`/api/v1/catalog.availability?variantId=${variantId}&locationId=${locationId}&quantity=1`);
      expect(await publicStock.json()).toMatchObject({available:false});
      const checkout=page.locator("form").filter({has:page.locator('input[name="intent"][value="checkoutCart"]')});
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
      if(locale==="ar") await expect(page.locator("html")).toHaveAttribute("dir","rtl");
      for(const theme of ["light","dark"]){
        await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);
        await page.reload();
        expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      }
      await checkout.locator('input[name="acceptedTerms"]').focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("Tab");
      await expect(checkout.getByRole("button")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/admin\/orders\/.+saved=checkoutCart/);
      const [placed]=await db().select().from(orders).where(eq(orders.cartId,cartId));
      expect(placed?.totalMinor).toBe(3000);
      expect((await db().select().from(cartItems).where(eq(cartItems.cartId,cartId)))[0]?.quantity).toBe(3);
      const active=await db().select().from(stockReservations).where(and(eq(stockReservations.status,"active"),eq(stockReservations.inventoryItemId,itemId)));
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({holderType:"order",holderId:placed!.id,quantity:3});
      await context.close();
    });
  }
});
