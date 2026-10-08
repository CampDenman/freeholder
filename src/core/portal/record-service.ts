// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.17: ownership is established before any module opens a record or acts.
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { contactForActor } from "./service";
import { portalSection } from "./sections";
const input = z.object({ section: z.string().regex(/^[a-z]+$/).max(40), id: z.uuid() });
async function owned(ctx: ServiceContext, asked: z.infer<typeof input>) {
  const contact = await contactForActor(ctx);
  const section = portalSection(asked.section);
  if (!section) throw new ServiceError("not_found", "That record is not available.");
  const record = (await section.load(ctx, contact.id, 200)).find(r=>r.id===asked.id);
  if (!record) throw new ServiceError("not_found", "That record is not available.");
  return { contact, section, record };
}
export const myRecord = defineService({
  name: "portal.myRecord", summary: "Open one of your own customer records without a bearer link.", kind: "query", permission: "authenticated", input,
  output: z.object({ id:z.uuid(), title:z.string(),status:z.string().nullable(),at:z.date().nullable(),amountMinor:z.number().int().nullable(),currency:z.string().nullable(),fields:z.array(z.object({labelKey:z.string(),value:z.string()})),lines:z.array(z.object({description:z.string(),amountMinor:z.number().int().optional(),currency:z.string().optional()})),links:z.array(z.object({labelKey:z.string(),href:z.string().startsWith("/")})),actions:z.array(z.enum(["accept","decline","cancel","download"])) }),
  handler: async (asked,ctx) => {
    const {contact,section,record} = await owned(ctx,asked);
    const details = section.detail ? await section.detail(ctx,contact.id,asked.id) : {};
    return {id:record.id,title:record.title,status:record.status,at:record.at,amountMinor:record.amountMinor??null,currency:record.currency??null,fields:details.fields??[],lines:details.lines??[],links:details.links??[],actions:details.actions??[]};
  },
});
export const actOnMyRecord = defineService({
  name:"portal.actOnMyRecord",summary:"Take an offered action on your own customer record.",kind:"mutation",permission:"authenticated",writeClass:"write",
  input:input.extend({action:z.enum(["accept","decline","cancel","download"]),name:z.string().trim().min(2).max(200).optional(),reason:z.string().trim().max(2000).optional()}),
  output:z.object({href:z.string().startsWith("/").optional()}),
  handler:async (asked,ctx)=>{
    const {contact,section}=await owned(ctx,asked);
    const details=section.detail?await section.detail(ctx,contact.id,asked.id):{};
    if(!section.act||!details.actions?.includes(asked.action))throw new ServiceError("permission","That action is not available.");
    const result=await section.act(ctx,contact.id,asked.id,asked);
    ctx.setSubject(asked.section,asked.id);
    return result;
  },
});
