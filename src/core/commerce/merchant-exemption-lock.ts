// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Serialize original profile/buyer tax decisions with provider phase admission.
import { sql } from "drizzle-orm";
import type { Tx } from "@/core/service";

export async function lockMerchantExemptionPolicy(tx:Tx,profileId:string,contactId:string):Promise<void>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-exemption-policy:${profileId}:${contactId}`}))`);
}
