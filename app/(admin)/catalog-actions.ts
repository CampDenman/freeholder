// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin catalog admin callers. Lifecycle rules, stale-write refusal and audit
// remain in the catalog services used by HTTP and MCP too.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addCartItem,
  addWishlistItem,
  cancelOrder,
  checkoutCart,
  applyCouponToCart,
  createCoupon,
  createFulfillment,
  createOfferRule,
  issueGiftCard,
  decideReturn,
  deliverFulfillment,
  failFulfillment,
  getOrCreateCart,
  packFulfillment,
  payOrder,
  receiveReturn,
  refundReturn,
  requestReturn,
  shipFulfillment,
  removeCartItem,
  removeWishlistItem,
  saveCart,
  setCartItemQuantity,
  addShippingRateBand,
  addPurchaseOrderLine,
  adjustStock,
  activateProduct,
  addOptionValue,
  applyVariantMatrix,
  archiveProduct,
  assignProductOption,
  createOptionType,
  addBundleComponent,
  addProductRelation,
  attachProductMedia,
  createAttributeDefinition,
  createCancellationPolicy,
  createCustomerGroup,
  createPriceList,
  deleteCancellationPolicy,
  cancelPurchaseOrder,
  countStock,
  createPurchaseOrder,
  createSupplier,
  createDeliveryWindow,
  createPackagingBox,
  createShippingMethod,
  createShippingZone,
  createProduct,
  detachProductMedia,
  enableInventory,
  placePurchaseOrder,
  receivePurchaseOrderLine,
  recordDamage,
  removeBundleComponent,
  removePriceRule,
  removeProductRelation,
  setInventoryLevels,
  setVariantStockPolicy,
  setPriceBreak,
  setPriceRule,
  restoreProduct,
  setDefaultVariant,
  setPriceListEntry,
  setProductAttribute,
  setProductOptionValues,
  transferStock,
  updateProduct,
  updateProductDescription,
  upsertServiceOffering,
} from "@/modules/catalog/service";
import type { EditorNode } from "./admin/BlockEditor";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function errorMessage(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  console.error("catalog action failed", error);
  return "The product could not be saved. Nothing was changed.";
}

export async function productAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  let destination = "/admin/products";
  try {
    const actor = await currentActor();
    if (intent === "create") {
      const product = await createProduct.call(
        {
          name: field(form, "name"),
          slug: field(form, "slug"),
          kind: field(form, "kind"),
          visibility: field(form, "visibility") || "public",
          subtitle: field(form, "subtitle") || undefined,
          brand: field(form, "brand") || undefined,
          taxCategoryId: field(form, "taxCategoryId") || undefined,
        },
        actor,
      );
      destination = `/admin/products/${product.id}?saved=created`;
    } else {
      const id = field(form, "id");
      const expectedVersion = Number(field(form, "expectedVersion"));
      destination = `/admin/products/${id}`;
      if (intent === "update") {
        await updateProduct.call(
          {
            id,
            expectedVersion,
            name: field(form, "name"),
            slug: field(form, "slug"),
            ...(field(form, "kind") ? { kind: field(form, "kind") } : {}),
            subtitle: field(form, "subtitle") || null,
            brand: field(form, "brand") || null,
            visibility: field(form, "visibility"),
            taxCategoryId: field(form, "taxCategoryId") || null,
            seo: {
              ...(field(form, "seoTitle") ? { title: field(form, "seoTitle") } : {}),
              ...(field(form, "seoDescription")
                ? { description: field(form, "seoDescription") }
                : {}),
            },
          },
          actor,
        );
      } else if (intent === "activate") {
        await activateProduct.call({ id, expectedVersion }, actor);
      } else if (intent === "archive") {
        await archiveProduct.call(
          { id, expectedVersion, reason: field(form, "reason") },
          actor,
        );
      } else if (intent === "restore") {
        await restoreProduct.call(
          { id, expectedVersion, reason: field(form, "reason") },
          actor,
        );
      } else if (intent === "createOptionType") {
        await createOptionType.call(
          { name: field(form, "name"), code: field(form, "code") },
          actor,
        );
      } else if (intent === "addOptionValue") {
        await addOptionValue.call(
          {
            optionTypeId: field(form, "optionTypeId"),
            name: field(form, "name"),
            skuFragment: field(form, "skuFragment"),
          },
          actor,
        );
      } else if (intent === "assignOption") {
        await assignProductOption.call(
          { productId: id, expectedVersion, optionTypeId: field(form, "optionTypeId") },
          actor,
        );
      } else if (intent === "setOptionValues") {
        await setProductOptionValues.call(
          {
            productId: id,
            expectedVersion,
            optionTypeId: field(form, "optionTypeId"),
            optionValueIds: form.getAll("optionValueId").flatMap((value) =>
              typeof value === "string" && value ? [value] : [],
            ),
          },
          actor,
        );
      } else if (intent === "applyMatrix") {
        await applyVariantMatrix.call({ productId: id, expectedVersion }, actor);
      } else if (intent === "setDefaultVariant") {
        await setDefaultVariant.call(
          { productId: id, expectedVersion, variantId: field(form, "variantId") },
          actor,
        );
      } else if (intent === "createAttribute") {
        await createAttributeDefinition.call(
          {
            key: field(form, "key"),
            label: field(form, "label"),
            kind: field(form, "kind") as "text" | "number" | "bool" | "enum" | "measure",
            ...(field(form, "unit") ? { unit: field(form, "unit") } : {}),
            ...(field(form, "groupName") ? { groupName: field(form, "groupName") } : {}),
            isFilterable: form.get("isFilterable") === "yes",
            isComparable: form.get("isComparable") === "yes",
            ...(field(form, "enumOptions")
              ? { enumOptions: field(form, "enumOptions").split(",").map((value) => value.trim()).filter(Boolean) }
              : {}),
          },
          actor,
        );
      } else if (intent === "setAttribute") {
        await setProductAttribute.call(
          {
            productId: id,
            expectedVersion,
            attributeId: field(form, "attributeId"),
            text: field(form, "text") || undefined,
            number: field(form, "number") || undefined,
            bool: field(form, "bool") ? field(form, "bool") === "yes" : undefined,
            enum: field(form, "enum") || undefined,
          },
          actor,
        );
      } else if (intent === "attachMedia") {
        await attachProductMedia.call(
          {
            productId: id,
            expectedVersion,
            assetId: field(form, "assetId"),
            role: field(form, "role") as "hero" | "gallery" | "swatch" | "size_chart" | "lifestyle" | "360" | "model",
            ...(field(form, "variantId") ? { variantId: field(form, "variantId") } : {}),
          },
          actor,
        );
      } else if (intent === "detachMedia") {
        await detachProductMedia.call(
          { productId: id, expectedVersion, mediaId: field(form, "mediaId") },
          actor,
        );
      } else if (intent === "createGroup") {
        await createCustomerGroup.call(
          {
            name: field(form, "name"),
            ...(field(form, "tag") ? { tag: field(form, "tag") } : {}),
            ...(field(form, "lifecycleStage")
              ? { lifecycleStage: field(form, "lifecycleStage") as "lead" | "prospect" | "customer" | "repeat" }
              : {}),
          },
          actor,
        );
        destination = "/admin/price-lists";
      } else if (intent === "createPriceList") {
        await createPriceList.call(
          {
            name: field(form, "name"),
            currency: field(form, "currency"),
            kind: field(form, "kind") as "retail" | "wholesale" | "member" | "sale" | "contract",
            ...(field(form, "customerGroupId") ? { customerGroupId: field(form, "customerGroupId") } : {}),
            ...(field(form, "contactId") ? { contactId: field(form, "contactId") } : {}),
            ...(field(form, "startsAt") ? { startsAt: new Date(field(form, "startsAt")) } : {}),
            ...(field(form, "endsAt") ? { endsAt: new Date(field(form, "endsAt")) } : {}),
            ...(field(form, "priority") ? { priority: Number(field(form, "priority")) } : {}),
          },
          actor,
        );
        destination = "/admin/price-lists";
      } else if (intent === "setPrice") {
        await setPriceListEntry.call(
          {
            priceListId: field(form, "priceListId"),
            variantId: field(form, "variantId"),
            amount: field(form, "amount"),
            ...(field(form, "compareAt") ? { compareAt: field(form, "compareAt") } : {}),
          },
          actor,
        );
        destination = field(form, "returnTo") || "/admin/price-lists";
      } else if (intent === "setBreak") {
        await setPriceBreak.call(
          {
            priceListId: field(form, "priceListId"),
            mode: field(form, "mode") as "volume" | "tiered",
            minQty: Number(field(form, "minQty")),
            ...(field(form, "maxQty") ? { maxQty: Number(field(form, "maxQty")) } : {}),
            ...(field(form, "variantId") ? { variantId: field(form, "variantId") } : {}),
            ...(field(form, "amount") ? { amount: field(form, "amount") } : {}),
            ...(field(form, "percentOffPpm")
              ? { percentOffPpm: Number(field(form, "percentOffPpm")) }
              : {}),
          },
          actor,
        );
        destination = field(form, "returnTo") || "/admin/price-lists";
      } else if (intent === "addRelation") {
        await addProductRelation.call(
          {
            productId: id,
            expectedVersion,
            relatedProductId: field(form, "relatedProductId"),
            kind: field(form, "kind") as
              | "upsell"
              | "cross_sell"
              | "accessory"
              | "replacement"
              | "variant_of",
          },
          actor,
        );
      } else if (intent === "removeRelation") {
        await removeProductRelation.call(
          { productId: id, expectedVersion, relationId: field(form, "relationId") },
          actor,
        );
      } else if (intent === "addComponent") {
        await addBundleComponent.call(
          {
            productId: id,
            expectedVersion,
            componentVariantId: field(form, "componentVariantId"),
            quantity: Number(field(form, "quantity") || "1"),
            priceMode: (field(form, "priceMode") || "sum") as "sum" | "fixed" | "percent_off",
            ...(field(form, "amount") ? { amount: field(form, "amount") } : {}),
            ...(field(form, "currency") ? { currency: field(form, "currency") } : {}),
            ...(field(form, "percentOffPpm")
              ? { percentOffPpm: Number(field(form, "percentOffPpm")) }
              : {}),
          },
          actor,
        );
      } else if (intent === "removeComponent") {
        await removeBundleComponent.call(
          { productId: id, expectedVersion, componentId: field(form, "componentId") },
          actor,
        );
      } else if (intent === "createPolicy") {
        await createCancellationPolicy.call(
          {
            name: field(form, "name"),
            ...(field(form, "freeUntilHours")
              ? { freeUntilHours: Number(field(form, "freeUntilHours")) }
              : {}),
            feeType: (field(form, "feeType") || "none") as
              | "none"
              | "fixed"
              | "percent"
              | "forfeit_deposit",
            ...(field(form, "feeAmount") ? { feeAmount: field(form, "feeAmount") } : {}),
            ...(field(form, "feePercentPpm")
              ? { feePercentPpm: Number(field(form, "feePercentPpm")) }
              : {}),
            ...(field(form, "rescheduleLimit")
              ? { rescheduleLimit: Number(field(form, "rescheduleLimit")) }
              : {}),
            ...(field(form, "noShowFeeAmount")
              ? { noShowFeeAmount: field(form, "noShowFeeAmount") }
              : {}),
            ...(field(form, "currency") ? { currency: field(form, "currency") } : {}),
          },
          actor,
        );
      } else if (intent === "deletePolicy") {
        await deleteCancellationPolicy.call({ id: field(form, "policyId") }, actor);
      } else if (intent === "saveOffering") {
        await upsertServiceOffering.call(
          {
            productId: id,
            durationMin: Number(field(form, "durationMin")),
            bufferBeforeMin: Number(field(form, "bufferBeforeMin") || "0"),
            bufferAfterMin: Number(field(form, "bufferAfterMin") || "0"),
            locationType: field(form, "locationType") as
              | "in_person"
              | "virtual"
              | "client_site",
            depositType: (field(form, "depositType") || "none") as "none" | "fixed" | "percent",
            ...(field(form, "depositAmount") ? { depositAmount: field(form, "depositAmount") } : {}),
            ...(field(form, "depositPercentPpm")
              ? { depositPercentPpm: Number(field(form, "depositPercentPpm")) }
              : {}),
            ...(field(form, "currency") ? { currency: field(form, "currency") } : {}),
            cancellationPolicyId: field(form, "cancellationPolicyId") || null,
            intakeFormId: field(form, "intakeFormId") || null,
            capacity: Number(field(form, "capacity") || "1"),
            assignment: (field(form, "assignment") || "specific") as
              | "specific"
              | "pool"
              | "round_robin",
            travelTimeMin: Number(field(form, "travelTimeMin") || "0"),
          },
          actor,
        );
      } else if (intent === "setPriceRule") {
        await setPriceRule.call(
          {
            productId: id,
            mode: field(form, "mode") as
              | "full"
              | "deposit_balance"
              | "payment_plan"
              | "hourly"
              | "retainer",
            ...(field(form, "installmentCount")
              ? { installmentCount: Number(field(form, "installmentCount")) }
              : {}),
            ...(field(form, "intervalDays")
              ? { intervalDays: Number(field(form, "intervalDays")) }
              : {}),
            ...(field(form, "periodDays") ? { periodDays: Number(field(form, "periodDays")) } : {}),
          },
          actor,
        );
      } else if (intent === "enableInventory") {
        await enableInventory.call(
          {
            variantId: field(form, "variantId"),
            locationId: field(form, "locationId"),
            ...(field(form, "bin") ? { bin: field(form, "bin") } : {}),
          },
          actor,
        );
        destination = "/admin/inventory";
      } else if (intent === "adjustStock") {
        await adjustStock.call(
          {
            itemId: field(form, "itemId"),
            delta: Number(field(form, "delta")),
            note: field(form, "note"),
          },
          actor,
        );
        destination = `/admin/inventory?item=${field(form, "itemId")}&saved=adjustStock`;
      } else if (intent === "countStock") {
        await countStock.call(
          {
            itemId: field(form, "itemId"),
            quantity: Number(field(form, "quantity")),
            ...(field(form, "note") ? { note: field(form, "note") } : {}),
          },
          actor,
        );
        destination = `/admin/inventory?item=${field(form, "itemId")}&saved=countStock`;
      } else if (intent === "recordDamage") {
        await recordDamage.call(
          {
            itemId: field(form, "itemId"),
            quantity: Number(field(form, "quantity")),
            note: field(form, "note"),
          },
          actor,
        );
        destination = `/admin/inventory?item=${field(form, "itemId")}&saved=recordDamage`;
      } else if (intent === "transferStock") {
        await transferStock.call(
          {
            fromItemId: field(form, "fromItemId"),
            toLocationId: field(form, "toLocationId"),
            quantity: Number(field(form, "quantity")),
            ...(field(form, "note") ? { note: field(form, "note") } : {}),
          },
          actor,
        );
        destination = `/admin/inventory?item=${field(form, "fromItemId")}&saved=transferStock`;
      } else if (intent === "setLevels") {
        await setInventoryLevels.call(
          {
            itemId: field(form, "itemId"),
            safetyStock: Number(field(form, "safetyStock") || "0"),
            reorderPoint: Number(field(form, "reorderPoint") || "0"),
            ...(field(form, "bin") ? { bin: field(form, "bin") } : {}),
          },
          actor,
        );
        destination = `/admin/inventory?item=${field(form, "itemId")}&saved=setLevels`;
      } else if (intent === "setStockPolicy") {
        await setVariantStockPolicy.call(
          {
            variantId: field(form, "variantId"),
            backorderPolicy: field(form, "backorderPolicy") as
              | "refuse"
              | "allow_date"
              | "allow_silent",
            ...(field(form, "expectedRestockAt")
              ? { expectedRestockAt: new Date(field(form, "expectedRestockAt")) }
              : {}),
          },
          actor,
        );
        destination = `/admin/inventory?item=${field(form, "itemId")}&saved=setStockPolicy`;
      } else if (intent === "createSupplier") {
        await createSupplier.call(
          {
            name: field(form, "name"),
            currency: field(form, "currency"),
            ...(field(form, "leadTimeDays")
              ? { leadTimeDays: Number(field(form, "leadTimeDays")) }
              : {}),
            ...(field(form, "contactId") ? { contactId: field(form, "contactId") } : {}),
          },
          actor,
        );
        destination = "/admin/procurement?saved=createSupplier";
      } else if (intent === "createPO") {
        const order = await createPurchaseOrder.call(
          {
            supplierId: field(form, "supplierId"),
            locationId: field(form, "locationId"),
            ...(field(form, "expectedAt") ? { expectedAt: new Date(field(form, "expectedAt")) } : {}),
          },
          actor,
        );
        destination = `/admin/procurement?order=${order.id}&saved=createPO`;
      } else if (intent === "addPOLine") {
        await addPurchaseOrderLine.call(
          {
            purchaseOrderId: field(form, "purchaseOrderId"),
            variantId: field(form, "variantId"),
            quantity: Number(field(form, "quantity")),
            unitCost: field(form, "unitCost"),
          },
          actor,
        );
        destination = `/admin/procurement?order=${field(form, "purchaseOrderId")}&saved=addPOLine`;
      } else if (intent === "placePO") {
        await placePurchaseOrder.call({ id: field(form, "purchaseOrderId") }, actor);
        destination = `/admin/procurement?order=${field(form, "purchaseOrderId")}&saved=placePO`;
      } else if (intent === "receivePOLine") {
        await receivePurchaseOrderLine.call(
          {
            lineId: field(form, "lineId"),
            quantity: Number(field(form, "quantity")),
            ...(field(form, "note") ? { note: field(form, "note") } : {}),
          },
          actor,
        );
        destination = `/admin/procurement?order=${field(form, "purchaseOrderId")}&saved=receivePOLine`;
      } else if (intent === "cancelPO") {
        await cancelPurchaseOrder.call({ id: field(form, "purchaseOrderId") }, actor);
        destination = `/admin/procurement?order=${field(form, "purchaseOrderId")}&saved=cancelPO`;
      } else if (intent === "createZone") {
        await createShippingZone.call(
          {
            name: field(form, "name"),
            countries: field(form, "countries")
              ? field(form, "countries").split(",").map((value) => value.trim()).filter(Boolean)
              : [],
            regions: field(form, "regions")
              ? field(form, "regions").split(",").map((value) => value.trim()).filter(Boolean)
              : [],
            postalPatterns: field(form, "postalPatterns")
              ? field(form, "postalPatterns").split(",").map((value) => value.trim()).filter(Boolean)
              : [],
            ...(field(form, "priority") ? { priority: Number(field(form, "priority")) } : {}),
          },
          actor,
        );
        destination = "/admin/shipping?saved=createZone";
      } else if (intent === "createMethod") {
        await createShippingMethod.call(
          {
            zoneId: field(form, "zoneId"),
            name: field(form, "name"),
            kind: field(form, "kind") as
              | "flat"
              | "weight"
              | "price"
              | "item"
              | "dimensional"
              | "free"
              | "pickup"
              | "local_delivery",
            currency: field(form, "currency"),
            ...(field(form, "amount") ? { amount: field(form, "amount") } : {}),
            ...(field(form, "threshold") ? { threshold: field(form, "threshold") } : {}),
            ...(field(form, "handlingFee") ? { handlingFee: field(form, "handlingFee") } : {}),
            ...(field(form, "locationId") ? { locationId: field(form, "locationId") } : {}),
          },
          actor,
        );
        destination = "/admin/shipping?saved=createMethod";
      } else if (intent === "addBand") {
        await addShippingRateBand.call(
          {
            methodId: field(form, "methodId"),
            currency: field(form, "currency"),
            minValue: Number(field(form, "minValue") || "0"),
            ...(field(form, "maxValue") ? { maxValue: Number(field(form, "maxValue")) } : {}),
            amount: field(form, "amount"),
          },
          actor,
        );
        destination = "/admin/shipping?saved=addBand";
      } else if (intent === "createBox") {
        await createPackagingBox.call(
          {
            name: field(form, "name"),
            innerLengthMm: Number(field(form, "innerLengthMm")),
            innerWidthMm: Number(field(form, "innerWidthMm")),
            innerHeightMm: Number(field(form, "innerHeightMm")),
            maxWeightG: Number(field(form, "maxWeightG")),
            tareWeightG: Number(field(form, "tareWeightG") || "0"),
          },
          actor,
        );
        destination = "/admin/shipping?saved=createBox";
      } else if (intent === "createWindow") {
        await createDeliveryWindow.call(
          {
            locationId: field(form, "locationId"),
            starts: field(form, "starts"),
            ends: field(form, "ends"),
            ...(field(form, "capacity") ? { capacity: Number(field(form, "capacity")) } : {}),
          },
          actor,
        );
        destination = "/admin/shipping?saved=createWindow";
      } else if (intent === "createCart") {
        const cart = await getOrCreateCart.call(
          {
            contactId: field(form, "contactId") || undefined,
            currency: field(form, "currency"),
          },
          actor,
        );
        destination = `/admin/carts/${cart.cart.id}?saved=createCart`;
      } else if (intent === "addCartItem") {
        const cart = await addCartItem.call(
          {
            cartId: field(form, "cartId"),
            variantId: field(form, "variantId"),
            quantity: Number(field(form, "quantity") || "1"),
            ...(field(form, "locationId") ? { locationId: field(form, "locationId") } : {}),
          },
          actor,
        );
        destination = `/admin/carts/${cart.cart.id}?saved=addCartItem`;
      } else if (intent === "setCartQty") {
        const cart = await setCartItemQuantity.call(
          {
            cartId: field(form, "cartId"),
            variantId: field(form, "variantId"),
            quantity: Number(field(form, "quantity") || "0"),
          },
          actor,
        );
        destination = `/admin/carts/${cart.cart.id}?saved=setCartQty`;
      } else if (intent === "removeCartItem") {
        const cart = await removeCartItem.call(
          {
            cartId: field(form, "cartId"),
            variantId: field(form, "variantId"),
          },
          actor,
        );
        destination = `/admin/carts/${cart.cart.id}?saved=removeCartItem`;
      } else if (intent === "saveCart") {
        const cart = await saveCart.call(
          { cartId: field(form, "cartId"), name: field(form, "name") },
          actor,
        );
        destination = `/admin/carts/${cart.cart.id}?saved=saveCart`;
      } else if (intent === "addWishlistItem") {
        await addWishlistItem.call(
          { contactId: field(form, "contactId"), variantId: field(form, "variantId") },
          actor,
        );
        destination = field(form, "returnTo") || `/admin/contacts/${field(form, "contactId")}`;
        destination += `${destination.includes("?") ? "&" : "?"}saved=addWishlistItem`;
      } else if (intent === "removeWishlistItem") {
        await removeWishlistItem.call(
          { contactId: field(form, "contactId"), variantId: field(form, "variantId") },
          actor,
        );
        destination = field(form, "returnTo") || `/admin/contacts/${field(form, "contactId")}`;
        destination += `${destination.includes("?") ? "&" : "?"}saved=removeWishlistItem`;
      } else if (intent === "checkoutCart") {
        const placed = await checkoutCart.call(
          {
            cartId: field(form, "cartId"),
            contactId: field(form, "contactId"),
            idempotencyKey: field(form, "idempotencyKey"),
            acceptedTerms: field(form, "acceptedTerms") === "yes",
            ...(field(form, "country")
              ? {
                  shippingAddress: {
                    name: field(form, "shipName") || undefined,
                    street1: field(form, "street1") || undefined,
                    city: field(form, "city") || undefined,
                    region: field(form, "region") || undefined,
                    postalCode: field(form, "postalCode") || undefined,
                    country: field(form, "country"),
                  },
                }
              : {}),
            ...(field(form, "shippingMethodId")
              ? { shippingMethodId: field(form, "shippingMethodId") }
              : {}),
            ...(field(form, "locationId") ? { locationId: field(form, "locationId") } : {}),
            ...(field(form, "couponCode") ? { couponCode: field(form, "couponCode") } : {}),
            ...(field(form, "giftCardCode") ? { giftCardCode: field(form, "giftCardCode") } : {}),
            applyBalance: field(form, "applyBalance") === "yes",
          },
          actor,
        );
        destination = `/admin/orders/${placed.order.id}?saved=checkoutCart`;
      } else if (intent === "payOrder") {
        await payOrder.call({ id: field(form, "id") }, actor);
        destination = `/admin/orders/${field(form, "id")}?saved=payOrder`;
      } else if (intent === "cancelOrder") {
        await cancelOrder.call({ id: field(form, "id") }, actor);
        destination = `/admin/orders/${field(form, "id")}?saved=cancelOrder`;
      } else if (intent === "createFulfillment") {
        const shipped = await createFulfillment.call(
          {
            orderId: field(form, "orderId"),
            ...(field(form, "locationId") ? { locationId: field(form, "locationId") } : {}),
            items: form.getAll("orderItemId").flatMap((value, index) => {
              if (typeof value !== "string" || !value) return [];
              const quantity = Number(form.getAll("quantity")[index] || "0");
              return quantity > 0 ? [{ orderItemId: value, quantity }] : [];
            }),
          },
          actor,
        );
        destination = `/admin/orders/${field(form, "orderId")}?saved=createFulfillment`;
        void shipped;
      } else if (intent === "packFulfillment") {
        await packFulfillment.call({ id: field(form, "id") }, actor);
        destination = `/admin/orders/${field(form, "orderId")}?saved=packFulfillment`;
      } else if (intent === "shipFulfillment") {
        await shipFulfillment.call(
          {
            id: field(form, "id"),
            ...(field(form, "carrier") ? { carrier: field(form, "carrier") } : {}),
            ...(field(form, "trackingNumber") ? { trackingNumber: field(form, "trackingNumber") } : {}),
            ...(field(form, "trackingUrl") ? { trackingUrl: field(form, "trackingUrl") } : {}),
          },
          actor,
        );
        destination = `/admin/orders/${field(form, "orderId")}?saved=shipFulfillment`;
      } else if (intent === "deliverFulfillment") {
        await deliverFulfillment.call({ id: field(form, "id") }, actor);
        destination = `/admin/orders/${field(form, "orderId")}?saved=deliverFulfillment`;
      } else if (intent === "failFulfillment") {
        await failFulfillment.call({ id: field(form, "id"), note: field(form, "note") }, actor);
        destination = `/admin/orders/${field(form, "orderId")}?saved=failFulfillment`;
      } else if (intent === "requestReturn") {
        const requested = await requestReturn.call(
          {
            orderId: field(form, "orderId"),
            reason: field(form, "reason"),
            restock: field(form, "restock") !== "no",
            items: form.getAll("orderItemId").flatMap((value, index) => {
              if (typeof value !== "string" || !value) return [];
              const quantity = Number(form.getAll("quantity")[index] || "0");
              return quantity > 0 ? [{ orderItemId: value, quantity }] : [];
            }),
          },
          actor,
        );
        destination = `/admin/returns?id=${requested.return.id}&saved=requestReturn`;
      } else if (intent === "decideReturn") {
        await decideReturn.call(
          {
            id: field(form, "id"),
            decision: field(form, "decision") as "approved" | "rejected",
          },
          actor,
        );
        destination = `/admin/returns?id=${field(form, "id")}&saved=decideReturn`;
      } else if (intent === "receiveReturn") {
        await receiveReturn.call(
          {
            id: field(form, "id"),
            ...(field(form, "locationId") ? { locationId: field(form, "locationId") } : {}),
          },
          actor,
        );
        destination = `/admin/returns?id=${field(form, "id")}&saved=receiveReturn`;
      } else if (intent === "refundReturn") {
        await refundReturn.call(
          { id: field(form, "id"), idempotencyKey: field(form, "idempotencyKey") },
          actor,
        );
        destination = `/admin/returns?id=${field(form, "id")}&saved=refundReturn`;
      } else if (intent === "createCoupon") {
        await createCoupon.call(
          {
            code: field(form, "code"),
            kind: field(form, "kind") as "percent" | "fixed" | "free_shipping",
            ...(field(form, "percentOffPpm") ? { percentOffPpm: Number(field(form, "percentOffPpm")) } : {}),
            ...(field(form, "amount") ? { amount: field(form, "amount") } : {}),
            ...(field(form, "currency") ? { currency: field(form, "currency") } : {}),
            ...(field(form, "minSubtotal") ? { minSubtotal: field(form, "minSubtotal") } : {}),
            ...(field(form, "maxRedemptions") ? { maxRedemptions: Number(field(form, "maxRedemptions")) } : {}),
          },
          actor,
        );
        destination = "/admin/promotions?saved=createCoupon";
      } else if (intent === "issueGiftCard") {
        await issueGiftCard.call(
          {
            code: field(form, "code"),
            currency: field(form, "currency"),
            amount: field(form, "amount"),
            ...(field(form, "contactId") ? { contactId: field(form, "contactId") } : {}),
          },
          actor,
        );
        destination = "/admin/promotions?saved=issueGiftCard";
      } else if (intent === "createOfferRule") {
        await createOfferRule.call(
          {
            kind: field(form, "kind") as "bump" | "post_add",
            name: field(form, "name"),
            offerVariantId: field(form, "offerVariantId"),
            ...(field(form, "triggerVariantId") ? { triggerVariantId: field(form, "triggerVariantId") } : {}),
          },
          actor,
        );
        destination = "/admin/promotions?saved=createOfferRule";
      } else if (intent === "applyCoupon") {
        await applyCouponToCart.call(
          { cartId: field(form, "cartId"), code: field(form, "code") },
          actor,
        );
        destination = `/admin/carts/${field(form, "cartId")}?saved=applyCoupon`;
      } else if (intent === "removePriceRule") {
        await removePriceRule.call(
          {
            productId: id,
            mode: field(form, "mode") as
              | "full"
              | "deposit_balance"
              | "payment_plan"
              | "hourly"
              | "retainer",
          },
          actor,
        );
      } else {
        throw new ServiceError("validation", "Choose a product action.");
      }
      if (!destination.includes("?")) destination += `?saved=${encodeURIComponent(intent)}`;
    }
  } catch (error) {
    const id = field(form, "id");
    destination = field(form, "returnTo") || (id ? `/admin/products/${id}` : "/admin/products/new");
    destination += `${destination.includes("?") ? "&" : "?"}error=${encodeURIComponent(errorMessage(error))}`;
  }
  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/procurement");
  revalidatePath("/admin/shipping");
  revalidatePath("/admin/carts");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/fulfillment");
  revalidatePath("/admin/returns");
  revalidatePath("/admin/promotions");
  redirect(destination);
}

export interface ProductDescriptionResult {
  error?: string;
  version?: number;
}

export async function saveProductDescriptionAction(
  id: string,
  expectedVersion: number,
  description: EditorNode[],
): Promise<ProductDescriptionResult> {
  try {
    const product = await updateProductDescription.call(
      { id, expectedVersion, description },
      await currentActor(),
    );
    revalidatePath(`/admin/products/${id}`);
    return { version: product.version };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
