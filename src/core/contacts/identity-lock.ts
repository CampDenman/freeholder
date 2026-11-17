// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C11.10: ownership must stay stable during privacy projection/erasure.
import {sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
export async function lockContactIdentity(tx:Tx):Promise<void>{
 const result=await tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(hashtext('contact-identity-privacy')) as locked`);
 if(!result[0]?.locked)throw new ServiceError("conflict","Another contact merge or privacy request is in progress. Please retry when it finishes.");
}

/** Background recovery waits for ordinary identity work instead of failing a committed physical observation. */
export async function lockContactIdentityForRecovery(tx: Tx): Promise<void> {
 await tx.execute(sql`select pg_advisory_xact_lock(hashtext('contact-identity-privacy'))`);
}

/** Background physical writers share with ordinary writes and wait for recovery or identity cutover. */
export async function lockContactIdentityForPhysicalWrite(tx: Tx): Promise<void> {
 await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('contact-identity-privacy'))`);
}

/** Committed-observation reconcilers follow physical facts that have ALREADY
 * committed and only admit idempotent retry work; they never minimize, retire
 * or repoint a contact. They must still stay outside a merge/erasure cutover,
 * which the shared mode gives them. Exclusive mode would not: these run inline
 * after every committed receipt, so an exclusive hold fails the ordinary
 * parallel write whose own receipt merely triggered them (C1.12/C11.08). */
export async function lockContactIdentityForObservationReconcile(tx: Tx): Promise<void> {
 await lockContactIdentityForPhysicalWrite(tx);
}

/** Ordinary writers may run together, but never across merge/erasure cutover. */
export async function lockContactIdentityForRead(tx: Tx): Promise<void> {
 const result = await tx.execute<{locked: boolean; heldExclusive: boolean}>(sql`
  with identity_key as (select hashtext('contact-identity-privacy')::bigint as value)
  select pg_try_advisory_xact_lock_shared(value) as locked,
   exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory'
    and database=(select oid from pg_database where datname=current_database())
    and classid=(value>>32)::integer and objid=(value&4294967295::bigint)::oid
    and objsubid=1 and mode='ExclusiveLock' and granted) as "heldExclusive"
  from identity_key
 `);
 if (!result[0]?.locked && !result[0]?.heldExclusive) throw new ServiceError("conflict", "Another contact merge or privacy request is in progress. Please retry when it finishes.");
}
