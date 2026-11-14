// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: source-owned exact preimages, never caller-supplied field subtraction.
import {inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type Tx} from "@/core/service";
import {invoices} from "./schema";
import {atomicCreditInvoiceProjection} from "./atomic-credit-before-image-contract";
import type {AtomicCreditFeeCurrentEntry} from "./atomic-credit-fee-partition-contract";
export async function captureAtomicCreditInvoiceProjections(tx:Tx,actualEntries:readonly AtomicCreditFeeCurrentEntry[]){
 const entries=actualEntries.filter(entry=>entry.key.startsWith("invoices:"));
 const ids=entries.map(entry=>z.uuid().parse(entry.key.slice("invoices:".length)));
 if(actualEntries.length>5000||new Set(ids).size!==ids.length)throw new ServiceError("conflict","Restore the exact bounded original invoice projection preimage.");
 if(!ids.length)return[];
 const rows=await tx.select({row:invoices,fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoices})::text,'UTF8')),'hex')`}).from(invoices).where(inArray(invoices.id,ids)).limit(5001);
 if(rows.length!==ids.length||rows.some(value=>entries.find(entry=>entry.key===`invoices:${value.row.id}`)?.postgres_row!==value.fingerprint))
  throw new ServiceError("conflict","The actual original invoice changed while retaining its full-row projection preimage.");
 return rows.map(({row})=>atomicCreditInvoiceProjection.parse({invoiceId:row.id,creditedMinor:row.creditedMinor,status:row.status,paidAt:row.paidAt?.toISOString()??null,updatedAt:row.updatedAt.toISOString()})).sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId));
}
