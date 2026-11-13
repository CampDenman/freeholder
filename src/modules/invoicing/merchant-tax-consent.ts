// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: public cart preview and private invoice use one canonical consent.
import {ServiceError} from "@/core/service";
import {merchantTaxDigest} from "./merchant-tax-store";
export function merchantTaxConsentDigest(parties:readonly {sellerUserId:string|null;quoteDigest:string}[]){
 if(!parties.length||new Set(parties.map(party=>party.sellerUserId)).size!==parties.length||parties.some(party=>!/^[a-f0-9]{64}$/.test(party.quoteDigest)))throw new ServiceError("conflict","The original merchant tax consent is incomplete or duplicated.");
 const ordered=[...parties].sort((a,b)=>(a.sellerUserId??"").localeCompare(b.sellerUserId??"")).map(({sellerUserId,quoteDigest})=>({sellerUserId,quoteDigest}));
 return ordered.length===1?ordered[0]!.quoteDigest:merchantTaxDigest(ordered);
}
