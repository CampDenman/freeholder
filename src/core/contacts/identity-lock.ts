// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C11.10: ownership must stay stable during privacy projection/erasure.
import {sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
export async function lockContactIdentity(tx:Tx):Promise<void>{
 const result=await tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(hashtext('contact-identity-privacy')) as locked`);
 if(!result[0]?.locked)throw new ServiceError("conflict","Another contact merge or privacy request is in progress. Please retry when it finishes.");
}
