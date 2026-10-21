// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a customer sees of the documents sent to them
// (MASTER.md §4.5, C8.11, C8.13).
//
// The same `documents.list` the owner reads, filtered to the caller's own
// contact by the framework rather than by anything here — C8.11's rule, and
// what stops a customer's view of what they were sent and the owner's view of
// the same from ever disagreeing.
//
// Archived documents are excluded. Archiving is the owner saying "this is no
// longer part of the relationship", and a portal that kept showing it would
// make archiving a filing decision with no effect on the person it is about.
import { registerPortalSection } from "@/core/portal/sections";
import { and,eq,isNull,gt,or } from "drizzle-orm";
import { documentShares } from "./schema";
import { listDocuments } from "./service";

registerPortalSection({
  key: "documents",
  // Before earnings and after the rooms about money owed: a customer looking
  // for the contract they signed is doing something more common than checking
  // a referral balance.
  order: 70,
  detail: async(ctx,contactId,id)=>{
    const document=(await ctx.call(listDocuments,{contactId,status:"shared",limit:200})).find(row=>row.id===id);
    if(!document)throw new Error("Document ownership changed.");
    const [share]=await ctx.tx.select({id:documentShares.id}).from(documentShares).where(and(eq(documentShares.documentId,id),eq(documentShares.contactId,contactId),eq(documentShares.access,"login"),isNull(documentShares.revokedAt),or(isNull(documentShares.expiresAt),gt(documentShares.expiresAt,new Date())))).limit(1);
    return {fields:document.description?[{labelKey:"portal.record.description",value:document.description}]:[],links:share?[{labelKey:"portal.record.download",href:`/portal/files/${id}`}]:[]};
  },
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listDocuments, { contactId, status: "shared", limit });
    return rows.map((document) => ({
      id: document.id,
      title: document.title,
      status: document.status,
      at: document.updatedAt,
      href: `/portal/records/documents/${document.id}`,
    }));
  },
});
