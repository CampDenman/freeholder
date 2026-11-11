// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {eq} from "drizzle-orm";
import {contacts} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {t} from "@/core/i18n";
import {createNotification} from "@/core/notifications/service";
import type {ServiceContext} from "@/core/service";
export async function notifyCommerceContact(ctx:ServiceContext,contactId:string,topic:string,key:string){
 const [contact]=await ctx.tx.select({locale:contacts.preferredLocale}).from(contacts).where(eq(contacts.id,contactId));
 const [business]=await ctx.tx.select({locale:businessProfile.defaultLocale}).from(businessProfile).limit(1);
 const locale=contact?.locale??business?.locale??"en";
 await ctx.callAsSystem(createNotification,{recipient:{kind:"contact",id:contactId},topic,title:t(locale,`catalog.notifications.${topic}.title`),body:t(locale,`catalog.notifications.${topic}.body`),idempotencyKey:key,dedupeKey:key});
}

export const notifyReturnRefund=(ctx:ServiceContext,contactId:string,returnId:string)=>notifyCommerceContact(ctx,contactId,"return.refunded",`return-refunded:${returnId}`);
