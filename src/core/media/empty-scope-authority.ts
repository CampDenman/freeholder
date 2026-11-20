// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: empty first capture is metadata, never provider I/O authority.
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {lockTransferInventory,requireTransferCapability,transferSchemaAvailable} from "./transfer-authority";
import {transferConflict} from "./transfer-proof";
export type EmptyMediaScope="media.storageTransfers"|"media.storageOperations"|"media.multipartOperations";
async function available(tx:Tx){const[proof]=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_empty_scope_graph_v1(uuid,text)') is not null and to_regprocedure('freeholder_media_empty_scope_writer_v1(uuid,text,uuid)') is not null as present`);return proof?.present===true;}
/** The shared privacy caller supplies its actual request identity. The DB
 * checks its contact/scope and every current/historical media birth again.
 * This path never sets the full media_transfer_v1/provider caller tag. */
export async function lockOriginalMediaScopeCapture(tx:Tx,input:{requestId:string;contactId:string;scope:EmptyMediaScope}):Promise<"complete_protocol"|"empty_metadata">{
 if(await transferSchemaAvailable(tx)){await lockTransferInventory(tx);return"complete_protocol";}
 await lockContactIdentityForRead(tx);await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
 if(await available(tx)){const[proof]=await tx.execute<{empty:boolean}>(sql`select freeholder_media_empty_scope_writer_v1(${input.requestId}::uuid,${input.scope},${input.contactId}::uuid) as empty`);if(proof?.empty===true)return"empty_metadata";}
 await requireTransferCapability(tx);return transferConflict("An original media birth, unknown ancestry or held resource needs the complete original protocol. Empty capture cannot replace that proof.");
}
/** An empty export/zero-work minimizer has nothing to mutate. It may not
 * inherit a writer tag or use an empty selected list to hide real births. */
export async function lockEmptyMediaEvidence(tx:Tx):Promise<void>{
 if(await transferSchemaAvailable(tx)){await lockTransferInventory(tx);return;}
 await lockContactIdentityForRead(tx);await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
 if(await available(tx)){const[proof]=await tx.execute<{empty:boolean}>(sql`select freeholder_media_empty_scope_graph_v1(null::uuid,null::text) as empty`);if(proof?.empty===true)return;}
 await requireTransferCapability(tx);
}
