// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stable original method identity; current ownership/revocation checked separately.
import { eq } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { paymentMethods } from "@/modules/invoicing/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionMethodScopeMatches } from "./merchant-scope-contract";
import type { MerchantControlledSubscriptionScope } from "@/adapters/payments";
import type { subscriptions } from "./schema";
export async function reviewedControlledMethod(ctx:ServiceContext,parent:typeof subscriptions.$inferSelect,scope:MerchantControlledSubscriptionScope){
 const[method]=parent.paymentMethodId?await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id,parent.paymentMethodId)).limit(1).for("share"):[];
 if(!method||method.status!=="active"||method.contactId!==parent.contactId||method.provider!=="stripe"||method.consentSource!=="provider_checkout"||!subscriptionMethodScopeMatches(scope,method)
  ||method.providerMethodRef!==scope.providerMethodRef||method.providerCustomerRef!==scope.providerCustomerRef)
  throw new ServiceError("conflict","Review the actual original-account saved method and its provider-verified consent before this changed-price collection; no current account or replacement method is inferred.");
 const original={methodId:method.id,provider:method.provider,providerMethodRef:method.providerMethodRef,providerCustomerRef:method.providerCustomerRef,providerPlatformAccountId:method.providerPlatformAccountId,
  providerAccountId:method.providerAccountId,providerApiVersion:scope.providerApiVersion,kind:method.kind};
 return{method,methodDigest:merchantTaxDigest(original),summary:{methodId:method.id,label:method.label,last4:method.last4,kind:method.kind}};
}
