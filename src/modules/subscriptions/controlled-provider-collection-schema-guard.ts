// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: literal exact guarded family capability, no registry composition.
import { sql } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
export async function requireControlledCollectionSchema(ctx:ServiceContext){
 const[ready]=await ctx.tx.execute<{ready:boolean}>(sql`select count(*)=12 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
  ((to_regclass('subscription_controlled_quotes'),'subscription_controlled_quotes_guard'),(to_regclass('subscription_controlled_quotes'),'subscription_controlled_quotes_complete'),
   (to_regclass('subscription_controlled_collections'),'subscription_controlled_collections_guard'),(to_regclass('subscription_controlled_collections'),'subscription_controlled_collections_complete'),
   (to_regclass('subscription_controlled_components'),'subscription_controlled_components_guard'),(to_regclass('subscription_controlled_components'),'subscription_controlled_components_complete'),
   (to_regclass('subscription_controlled_invoice_bindings'),'subscription_controlled_invoice_bindings_guard'),(to_regclass('subscription_controlled_invoice_bindings'),'subscription_controlled_invoice_bindings_complete'),
   (to_regclass('subscription_controlled_item_receipts'),'subscription_controlled_item_receipts_guard'),(to_regclass('subscription_controlled_item_receipts'),'subscription_controlled_item_receipts_complete'),
   (to_regclass('subscription_controlled_invoice_proofs'),'subscription_controlled_invoice_proofs_guard'),(to_regclass('subscription_controlled_invoice_proofs'),'subscription_controlled_invoice_proofs_complete'))`);
 if(!ready?.ready)throw new ServiceError("conflict","Install every guarded exact controlled quote/target/component/creator/item/read family before positive collection work.");
}
