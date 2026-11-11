// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.16/C5.20: a cart's own hold is available to that cart, and nobody else.
import {afterAll,beforeEach,describe,expect,it} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {createContact} from "@/core/contacts/service";
import {createLocationService} from "@/core/locations/service";
import {cartItems,productVariants,stockReservations} from "@/modules/catalog/schema";
import {addCartItem,applyVariantMatrix,availability,checkoutCart,createPriceList,createProduct,enableInventory,getCart,getOrCreateCart,getProductVariants,recordStockMovement,setPriceListEntry} from "@/modules/catalog/service";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";

describe.runIf(hasDatabase)("cart-owned stock reservations (C5.16/C5.20)",()=>{
  beforeEach(truncateSpine);
  afterAll(closeDb);
  async function stock(quantity=3){
    const product=await createProduct.call({name:"Reserved print",slug:"reserved-print",kind:"physical"},OWNER);
    const updated=await applyVariantMatrix.call({productId:product.id,expectedVersion:product.version},OWNER);
    const variant=(await getProductVariants.call({productId:updated.id},OWNER)).variants[0]!;
    await db().update(productVariants).set({requiresShipping:false}).where(eq(productVariants.id,variant.id));
    const list=await createPriceList.call({name:"Reserved retail",currency:"CAD",kind:"retail"},OWNER);
    await setPriceListEntry.call({priceListId:list.id,variantId:variant.id,amount:"10.00"},OWNER);
    const location=await createLocationService.call({name:"Stockroom",slug:"stockroom",country:"CA"},OWNER);
    const item=await enableInventory.call({variantId:variant.id,locationId:location.id},OWNER);
    await recordStockMovement.call({itemId:item.id,delta:quantity,reason:"receipt"},OWNER);
    return {variant,location};
  }
  async function basket(name:string){
    const contact=await createContact.call({name,email:`${name}@example.test`},OWNER);
    const cart=await getOrCreateCart.call({contactId:contact.id,currency:"CAD"},OWNER);
    return {contact,cart};
  }
  it("checks out all remaining stock already held by the same cart",async()=>{
    const {variant,location}=await stock();
    const {contact,cart}=await basket("same-cart");
    const filled=await addCartItem.call({cartId:cart.cart.id,variantId:variant.id,quantity:3,locationId:location.id},OWNER);
    expect(filled.allAvailable).toBe(true);
    expect((await getCart.call({cartId:cart.cart.id},OWNER)).allAvailable).toBe(true);
    expect((await availability.call({variantId:variant.id,locationId:location.id,quantity:1},OWNER)).available).toBe(false);
    const placed=await checkoutCart.call({cartId:cart.cart.id,contactId:contact.id,acceptedTerms:true,idempotencyKey:"held-stock-checkout"},OWNER);
    expect(placed.order.status).toBe("pending_payment");
  });
  it("increases an existing cart hold using its own units without overbooking",async()=>{
    const {variant,location}=await stock();
    const {cart}=await basket("increase-cart");
    await addCartItem.call({cartId:cart.cart.id,variantId:variant.id,quantity:2,locationId:location.id},OWNER);
    const increased=await addCartItem.call({cartId:cart.cart.id,variantId:variant.id,quantity:1,locationId:location.id},OWNER);
    expect(increased.allAvailable).toBe(true);
    expect(increased.lines[0]!.quantity).toBe(3);
    await expect(addCartItem.call({cartId:cart.cart.id,variantId:variant.id,quantity:1,locationId:location.id},OWNER)).rejects.toMatchObject({code:"validation"});
  });
  it("does not give another cart the units held for someone else",async()=>{
    const {variant,location}=await stock();
    const first=await basket("first-cart"),second=await basket("second-cart");
    await addCartItem.call({cartId:first.cart.cart.id,variantId:variant.id,quantity:2,locationId:location.id},OWNER);
    expect((await addCartItem.call({cartId:second.cart.cart.id,variantId:variant.id,quantity:1,locationId:location.id},OWNER)).allAvailable).toBe(true);
    await expect(addCartItem.call({cartId:second.cart.cart.id,variantId:variant.id,quantity:1,locationId:location.id},OWNER)).rejects.toMatchObject({code:"validation"});
    expect((await getCart.call({cartId:first.cart.cart.id},OWNER)).allAvailable).toBe(true);
  });
  it("does not count an expired hold or a foreign reservation pointer",async()=>{
    const {variant,location}=await stock();
    const first=await basket("expired-cart"),second=await basket("other-cart");
    const held=await addCartItem.call({cartId:first.cart.cart.id,variantId:variant.id,quantity:3,locationId:location.id},OWNER);
    await db().update(stockReservations).set({expiresAt:new Date(0)}).where(eq(stockReservations.id,held.lines[0]!.reservationId!));
    const other=await addCartItem.call({cartId:second.cart.cart.id,variantId:variant.id,quantity:3,locationId:location.id},OWNER);
    expect((await getCart.call({cartId:first.cart.cart.id},OWNER)).allAvailable).toBe(false);
    await db().update(cartItems).set({reservationId:other.lines[0]!.reservationId}).where(eq(cartItems.id,held.lines[0]!.id));
    expect((await getCart.call({cartId:first.cart.cart.id},OWNER)).allAvailable).toBe(false);
    expect((await getCart.call({cartId:second.cart.cart.id},OWNER)).allAvailable).toBe(true);
  });
});
