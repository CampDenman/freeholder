// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {TransferRequestObservation} from './media-transfer.mjs';
export type OriginalStorageXml=Record<string,unknown>;
export function parseOriginalStorageXml(source:string):OriginalStorageXml;
export function readOriginalStorageXml(response:Response,notify?:((facts:TransferRequestObservation)=>Promise<void>),options?:{stage?:'response_body'|'inventory_raw';allowEmpty?:boolean;requireSuccess?:boolean}):Promise<OriginalStorageXml|null>;
export function storageXmlRecord(document:OriginalStorageXml,name:string):Record<string,unknown>;
export function storageXmlText(node:Record<string,unknown>,name:string,optional?:boolean):string|undefined;
export function storageXmlRows(node:unknown):unknown[];
export function storageXmlHasError(document:unknown):boolean;
