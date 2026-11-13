// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: absent/partial installed15-family protocol never admits positive work.
import { sql } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
export const CONTROLLED_FINANCIAL_PROTOCOL="controlled_net_gross.v1";
export async function requireControlledFinancialProtocol(tx:Tx){
 const[actual]=await tx.execute<{ready:boolean}>(sql`select count(*)=24
  and to_regprocedure('freeholder_controlled_target_operation_admissible(uuid)') is not null
  and position('controlled_net_gross.v1' in pg_get_functiondef(to_regprocedure('freeholder_controlled_target_operation_admissible(uuid)')))>0
  and position('freeholder_controlled_target_operation_admissible' in pg_get_functiondef(to_regprocedure('freeholder_controlled_operation_admissible(uuid)')))>0
  and position('targetFinancialRevision' in pg_get_functiondef(to_regprocedure('freeholder_controlled_target_operation_admissible(uuid)')))>0 as ready
  from pg_trigger t where not t.tgisinternal and t.tgenabled in('O','A') and(t.tgrelid,t.tgname) in(
   (to_regclass('subscription_controlled_resources'),'subscription_controlled_resources_guard'),(to_regclass('subscription_controlled_operations'),'subscription_controlled_operations_guard'),
   (to_regclass('subscription_controlled_calls'),'subscription_controlled_calls_guard'),(to_regclass('subscription_controlled_facts'),'subscription_controlled_facts_guard'),
   (to_regclass('subscription_controlled_finishes'),'subscription_controlled_finishes_guard'),(to_regclass('subscription_controlled_stops'),'subscription_controlled_stops_guard'),
   (to_regclass('subscription_controlled_verifications'),'subscription_controlled_verifications_guard'),(to_regclass('subscription_controlled_charge_origins'),'subscription_controlled_origins_guard'),
   (to_regclass('subscription_controlled_closures'),'subscription_controlled_closures_guard'),(to_regclass('subscription_provider_charge_receipts'),'subscription_controlled_charge_origin_guard'),
   (to_regclass('subscription_provider_schedule_operations'),'subscription_controlled_legacy_charge_guard'),(to_regclass('subscription_provider_schedule_resources'),'subscription_controlled_financial_stop_guard'),
   (to_regclass('subscription_controlled_quotes'),'subscription_controlled_quotes_guard'),(to_regclass('subscription_controlled_quotes'),'subscription_controlled_quotes_complete'),
   (to_regclass('subscription_controlled_collections'),'subscription_controlled_collections_guard'),(to_regclass('subscription_controlled_collections'),'subscription_controlled_collections_complete'),
   (to_regclass('subscription_controlled_components'),'subscription_controlled_components_guard'),(to_regclass('subscription_controlled_components'),'subscription_controlled_components_complete'),
   (to_regclass('subscription_controlled_invoice_bindings'),'subscription_controlled_invoice_bindings_guard'),(to_regclass('subscription_controlled_invoice_bindings'),'subscription_controlled_invoice_bindings_complete'),
   (to_regclass('subscription_controlled_item_receipts'),'subscription_controlled_item_receipts_guard'),(to_regclass('subscription_controlled_item_receipts'),'subscription_controlled_item_receipts_complete'),
   (to_regclass('subscription_controlled_invoice_proofs'),'subscription_controlled_invoice_proofs_guard'),(to_regclass('subscription_controlled_invoice_proofs'),'subscription_controlled_invoice_proofs_complete'))`);
 if(!actual?.ready)throw new ServiceError("conflict","Install the complete authentic15-family controlled target/caller protocol before collection admission; a legacy or partial guard set cannot supply this capability.");
}
