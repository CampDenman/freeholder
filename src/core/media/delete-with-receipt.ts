// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.22/C11.08: route cleanup through exact original physical proof.
import type {CapturedStorage} from "./write-ledger";
import {deleteTransferredLineage} from "./transfer-erasure";
import {retireOriginalMediaObject} from "./original-retirement";

export async function deleteWithReceipt(key:string,captured?:CapturedStorage):Promise<boolean>{
 const transferred=await deleteTransferredLineage(key);
 if(transferred!==undefined)return transferred;
 return retireOriginalMediaObject(key,captured?.binding);
}
