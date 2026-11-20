// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface TransferDrainSnapshot {
 plan:{id:string;sourceNamespace:string;targetNamespace:string;[name:string]:unknown};
 objects:Record<string,unknown>[];callers:Record<string,unknown>[];requests:Record<string,unknown>[];receipts:Record<string,unknown>[];
}
export interface CapturedTransferDrainAssociation {
 format:"freeholder.media-transfer-drain/v1";planId:string;namespace:string;snapshot:TransferDrainSnapshot;
}
/** Structural equality only; actual fenced SQL and real operator stop required. */
export function requireTransferDrainAssociation(captured:unknown,options:{planId:string|undefined;namespace:string;snapshot:unknown}):CapturedTransferDrainAssociation;
