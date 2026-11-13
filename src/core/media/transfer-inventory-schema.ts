// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: first provider enumeration is immutable and distinct from birth.
import {sql} from "drizzle-orm";
import {bigint,check,index,integer,jsonb,pgTable,text,timestamp,uniqueIndex,uuid} from "drizzle-orm/pg-core";
import type {StorageBinding} from "@/adapters/storage/types";
import type {TransferInventoryConfiguration,TransferInventoryEntry} from "../../../scripts/media-transfer.mjs";
import {createdAtColumn,updatedAtColumn} from "@/core/db/columns";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans} from "./transfer-schema";
export const mediaStorageProviderInventories=pgTable("media_storage_provider_inventories",{
 id:uuid("id").primaryKey().defaultRandom(),planId:uuid("plan_id").notNull().references(()=>mediaStorageTransferPlans.id,{onDelete:"restrict"}),
 anchorCallId:uuid("anchor_call_id").references(()=>mediaStorageTransferCalls.id,{onDelete:"restrict"}),
 objectId:uuid("object_id").references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 side:text("side",{enum:["source","target"]}).notNull(),purpose:text("purpose",{enum:["baseline","retirement","erasure"]}).notNull(),
 binding:jsonb("binding").$type<StorageBinding>().notNull(),namespace:text("namespace").notNull(),
 state:text("state",{enum:["capturing","complete","blocked"]}).notNull().default("capturing"),
 firstDigest:text("first_digest"),confirmedDigest:text("confirmed_digest"),
 configuration:jsonb("configuration").$type<TransferInventoryConfiguration>(),
 entryCount:integer("entry_count").notNull().default(0),totalBytes:bigint("total_bytes",{mode:"number"}).notNull().default(0),
 blocker:text("blocker"),completedAt:timestamp("completed_at",{withTimezone:true}),redactedAt:timestamp("redacted_at",{withTimezone:true}),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 uniqueIndex("media_storage_provider_inventory_baseline_idx").on(t.planId,t.side).where(sql`${t.purpose}='baseline'`),
 uniqueIndex("media_storage_provider_inventory_anchor_idx").on(t.objectId,t.side,t.purpose,t.anchorCallId),
 index("media_storage_provider_inventory_object_idx").on(t.objectId,t.createdAt),
 check("media_storage_provider_inventory_side",sql`${t.side} in ('source','target')`),
 check("media_storage_provider_inventory_purpose",sql`${t.purpose} in ('baseline','retirement','erasure')`),
 check("media_storage_provider_inventory_state",sql`${t.state} in ('capturing','complete','blocked')`),
 check("media_storage_provider_inventory_namespace",sql`${t.namespace} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_provider_inventory_complete",sql`${t.state}<>'complete' or (${t.completedAt} is not null and ${t.firstDigest} ~ '^[a-f0-9]{64}$' and ${t.firstDigest}=${t.confirmedDigest})`),
]);
export const mediaStorageProviderInventoryPages=pgTable("media_storage_provider_inventory_pages",{
 id:uuid("id").primaryKey().defaultRandom(),inventoryId:uuid("inventory_id").notNull().references(()=>mediaStorageProviderInventories.id,{onDelete:"restrict"}),
 callId:uuid("call_id").notNull().references(()=>mediaStorageTransferCalls.id,{onDelete:"restrict"}),
 pass:integer("pass").notNull(),kind:text("kind",{enum:["configuration","objects","versions","sessions","retained"]}).notNull(),
 cursor:jsonb("cursor").$type<Record<string,string>|null>(),cursorDigest:text("cursor_digest").notNull(),
 nextCursor:jsonb("next_cursor").$type<Record<string,string>|null>(),
 membershipDigest:text("membership_digest").notNull(),
 pageDigest:text("page_digest").notNull(),entryCount:integer("entry_count").notNull(),
 configuration:jsonb("configuration").$type<TransferInventoryConfiguration>(),
 redactedAt:timestamp("redacted_at",{withTimezone:true}),createdAt:createdAtColumn(),
},t=>[
 uniqueIndex("media_storage_provider_inventory_page_idx").on(t.inventoryId,t.pass,t.kind,t.cursorDigest),
 check("media_storage_provider_inventory_page_pass",sql`${t.pass} in (0,1)`),
 check("media_storage_provider_inventory_page_kind",sql`${t.kind} in ('configuration','objects','versions','sessions','retained')`),
 check("media_storage_provider_inventory_page_digests",sql`${t.cursorDigest} ~ '^[a-f0-9]{64}$' and ${t.pageDigest} ~ '^[a-f0-9]{64}$' and ${t.membershipDigest} ~ '^[a-f0-9]{64}$'`),
]);
export const mediaStorageProviderInventoryEntries=pgTable("media_storage_provider_inventory_entries",{
 id:uuid("id").primaryKey().defaultRandom(),pageId:uuid("page_id").notNull().references(()=>mediaStorageProviderInventoryPages.id,{onDelete:"restrict"}),
 inventoryId:uuid("inventory_id").notNull().references(()=>mediaStorageProviderInventories.id,{onDelete:"restrict"}),
 ordinal:integer("ordinal").notNull(),
 pass:integer("pass").notNull(),entry:jsonb("entry").$type<TransferInventoryEntry>().notNull(),
 entryDigest:text("entry_digest").notNull(),
 keyDigest:text("key_digest").notNull(),resourceDigest:text("resource_digest").notNull(),
 originalObjectId:uuid("original_object_id").references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 attribution:text("attribution",{enum:["original_current","preexisting_target","unattributed","retained_original"]}).notNull(),
 redactedAt:timestamp("redacted_at",{withTimezone:true}),createdAt:createdAtColumn(),
},t=>[
 uniqueIndex("media_storage_provider_inventory_entry_ordinal_idx").on(t.pageId,t.ordinal),
 uniqueIndex("media_storage_provider_inventory_resource_idx").on(t.inventoryId,t.pass,t.resourceDigest),
 index("media_storage_provider_inventory_entry_key_idx").on(t.keyDigest,t.attribution),
 check("media_storage_provider_inventory_entry_attribution",sql`${t.attribution} in ('original_current','preexisting_target','unattributed','retained_original')`),
 check("media_storage_provider_inventory_entry_digests",sql`${t.keyDigest} ~ '^[a-f0-9]{64}$' and ${t.resourceDigest} ~ '^[a-f0-9]{64}$' and ${t.entryDigest} ~ '^[a-f0-9]{64}$'`),
]);
