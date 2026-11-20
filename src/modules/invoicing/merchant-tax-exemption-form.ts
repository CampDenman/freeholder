// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: bounded human fields, parsed again by the actual shared service.
export function merchantTaxExemptionReviewValues(form:FormData){
 const text=(key:string)=>{const value=form.get(key);return typeof value==="string"?value:"";};
 const expires=text("expiresAt");
 return{id:text("id"),expectedStatus:text("expectedStatus"),decision:text("decision"),confirmEvidence:form.get("confirmEvidence")==="on",expiresAt:expires?new Date(`${expires}Z`):null};
}
