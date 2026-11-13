// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: one fixed-point calculation for invoice persistence and buyer consent.
import type {QuotedTaxLine} from "@/adapters/tax";
import {ServiceError} from "@/core/service";
import {extendMinor,subtractMinor,sumMinor} from "./money";

type Line={quantityMicros:number;unitAmountMinor:number;discountMinor:number};
type Quote={lines:readonly QuotedTaxLine[]};
export function calculateInvoiceAmounts<T extends Line>(lines:readonly T[],shippingMinor:number,quote:Quote,preDiscountQuote:Quote=quote,keys=lines.map((_,index)=>`line:${index}`)){
 if(keys.length!==lines.length||new Set(keys).size!==keys.length)throw new ServiceError("conflict","Each quoted invoice line needs one original calculation key.");
 const known=new Set(keys);
 if([...quote.lines,...preDiscountQuote.lines].some(line=>line.itemId!==undefined&&!known.has(line.itemId)))throw new ServiceError("conflict","The tax calculation names an unrelated invoice line.");
 const calculatedLines=lines.map((line,index)=>{
  const key=keys[index]!,grossSubtotal=extendMinor(line.unitAmountMinor,line.quantityMicros);
  if(line.discountMinor>grossSubtotal)throw new ServiceError("validation",`Line ${index+1}'s discount exceeds its extended amount.`);
  const currentTax=quote.lines.filter(tax=>tax.itemId===key),beforeTax=preDiscountQuote.lines.filter(tax=>tax.itemId===key);
  const includedAfter=sumMinor(currentTax.filter(tax=>tax.inclusive).map(tax=>tax.taxMinor),"Included line tax");
  const includedBefore=sumMinor(beforeTax.filter(tax=>tax.inclusive).map(tax=>tax.taxMinor),"Included pre-discount tax");
  const taxDiscount=subtractMinor(includedBefore,includedAfter,"Included-tax discount");
  const subtotalMinor=subtractMinor(grossSubtotal,includedBefore,"Net line subtotal");
  const discountMinor=subtractMinor(line.discountMinor,taxDiscount,"Net line discount");
  const taxMinor=sumMinor(currentTax.map(tax=>tax.taxMinor),"Line tax");
  return{input:line,key,position:index,subtotalMinor,discountMinor,taxMinor,totalMinor:sumMinor([subtractMinor(subtotalMinor,discountMinor,"Net line"),taxMinor],"Line total")};
 });
 const shippingTaxes=quote.lines.filter(line=>!line.itemId);
 const includedShippingTax=sumMinor(shippingTaxes.filter(line=>line.inclusive).map(line=>line.taxMinor),"Included shipping tax");
 const netShippingMinor=subtractMinor(shippingMinor,includedShippingTax,"Net shipping");
 const subtotalMinor=sumMinor(calculatedLines.map(line=>line.subtotalMinor),"Invoice subtotal");
 const discountMinor=sumMinor(calculatedLines.map(line=>line.discountMinor),"Invoice discount");
 const taxMinor=sumMinor(quote.lines.map(line=>line.taxMinor),"Invoice tax");
 const totalMinor=sumMinor([subtractMinor(subtotalMinor,discountMinor,"Invoice subtotal after discount"),netShippingMinor,taxMinor],"Invoice total");
 return{calculatedLines,subtotalMinor,discountMinor,shippingMinor:netShippingMinor,shippingTaxMinor:sumMinor(shippingTaxes.map(line=>line.taxMinor),"Shipping tax"),taxMinor,totalMinor};
}
