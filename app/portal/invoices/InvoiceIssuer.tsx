// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { z } from "zod";
import type { publicInvoiceIssuer } from "@/modules/invoicing/merchant-identity";
import type { Translate } from "@/core/i18n";

export function InvoiceIssuer({issuer,businessName,locale,t}:{issuer:z.infer<typeof publicInvoiceIssuer>;businessName:string;locale:string;t:Translate}){
  const support=issuer.issuerSupport,address=support?.address;
  const name=issuer.issuerIsMerchant?issuer.issuerName??t("customerInvoice.merchantUnavailable"):businessName;
  const phone=support?.phone,dial=phone?.replace(/[ ()-]/g,"");
  return <div className="grid gap-2 [overflow-wrap:anywhere] text-sm text-ink-muted">
    <p><bdi>{name}</bdi></p>
    {support?<address className="grid gap-1 not-italic" aria-label={t("customerInvoice.merchantSupport")}>
      <p className="font-medium">{t("customerInvoice.merchantSupport")}</p>
      {support.email?<a className="text-accent underline" href={`mailto:${encodeURIComponent(support.email)}`}><bdi>{support.email}</bdi></a>:null}
      {phone?dial&&/^\+?[0-9]{3,30}$/.test(dial)?<a className="text-accent underline" href={`tel:${dial}`}><bdi>{phone}</bdi></a>:<p><bdi>{phone}</bdi></p>:null}
      {support.url?<a className="text-accent underline" href={support.url} rel="noreferrer"><bdi>{support.url}</bdi></a>:null}
      {address?<div>{[address.line1,address.line2,[address.city,address.state,address.postalCode].filter(Boolean).join(", "),new Intl.DisplayNames([locale],{type:"region"}).of(address.country)??address.country].filter(Boolean).map((line,index)=><p key={index}><bdi>{line}</bdi></p>)}</div>:null}
    </address>:null}
  </div>;
}
