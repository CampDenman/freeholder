// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own quotes, in the portal (MASTER.md §43 C8.11).
//
// `quotes.list` already takes a `contactId`, because an owner needed to ask
// "what has this person been offered?". A customer asking that about
// themselves is the same query with the same filter, so this calls it rather
// than growing a second read path that could one day answer differently.
//
import { registerPortalSection } from "@/core/portal/sections";
import { and,eq } from "drizzle-orm";
import { quotes } from "./schema";
import { ServiceError } from "@/core/service";
import { listQuotes, quoteByToken, acceptQuote, declineQuote } from "./service";

registerPortalSection({
  key: "quotes",
  order: 10,
  detail: async (ctx, contactId, id) => {
    const [row] = await ctx.tx.select().from(quotes).where(and(eq(quotes.id,id),eq(quotes.contactId,contactId))).limit(1);
    if (!row?.viewToken) return { fields:[{labelKey:"portal.record.unavailable",value:""}] };
    const view = await ctx.call(quoteByToken,{token:row.viewToken});
    if (!view) throw new ServiceError("not_found","This quote is unavailable.");
    return { fields:view.terms ? [{labelKey:"portal.record.terms",value:view.terms}] : [], lines:view.items.map(item=>({description:item.description,amountMinor:Math.round(item.quantityMicros*item.unitPriceMinor/1000000),currency:view.currency})),actions:view.open ? ["accept" as const,"decline" as const] : [] };
  },
  act: async (ctx,contactId,id,input) => {
    const [row] = await ctx.tx.select({token:quotes.viewToken}).from(quotes).where(and(eq(quotes.id,id),eq(quotes.contactId,contactId))).limit(1);
    if(!row?.token)throw new ServiceError("not_found","This quote is unavailable.");
    if(input.action === "accept")await ctx.call(acceptQuote,{token:row.token,acceptedName:input.name??""});
    else if(input.action === "decline")await ctx.call(declineQuote,{token:row.token,reason:input.reason});
    else throw new ServiceError("permission","This action is unavailable.");
    return {};
  },
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listQuotes, { contactId, limit });
    return rows.map((quote) => ({
      id: quote.id,
      title: quote.title || quote.reference,
      status: quote.status,
      at: quote.sentAt ?? quote.validUntil ?? null,
      href: `/portal/records/quotes/${quote.id}`,
      amountMinor: quote.totalMinor,
      currency: quote.currency,
    }));
  },
});
