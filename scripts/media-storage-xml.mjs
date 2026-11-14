// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A complete bounded provider document is evidence; a success substring is not.
import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
const MAX_XML=2*1024*1024;
const invalid=()=>{throw Error('storage: the complete original provider XML document is invalid or exceeds its bound');};
export function parseOriginalStorageXml(source){
 if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>MAX_XML)invalid();
 // S3 COMPLETE may send keep-alive whitespace before its final declaration.
 // Strip only that outer framing; retain the exact original wire digest.
 source=source.replace(/^\s+(?=<\?xml\s)/,'');
 if(Buffer.byteLength(source,'utf8')>MAX_XML||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(source)||/<\?(?!xml(?:\s|\?))/i.test(source)||/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/.test(source)||XMLValidator.validate(source)!==true)invalid();
 const parsed=new XMLParser({ignoreAttributes:true,parseTagValue:false,ignoreDeclaration:true,ignorePiTags:true,processEntities:true,trimValues:false}).parse(source);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==1)invalid();
 return parsed;
}
export async function readOriginalStorageXml(response,notify,{stage='response_body',allowEmpty=false,requireSuccess=false}={}){
 if(requireSuccess&&!response.ok)invalid();
 const chunks=[];let bytes=0;
 if(response.body){const reader=response.body.getReader();try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>MAX_XML)invalid();chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
 const wire=Buffer.concat(chunks);
 if(notify)await notify({stage,status:response.status,detailDigest:createHash('sha256').update(wire).digest('hex'),bytes:wire.byteLength});
 if(!wire.byteLength&&allowEmpty)return null;
 return parseOriginalStorageXml(new TextDecoder('utf-8',{fatal:true}).decode(wire));
}
export function storageXmlRecord(document,name){const node=document?.[name];if(!node||typeof node!=='object'||Array.isArray(node)||Object.keys(document).length!==1)invalid();return node;}
export function storageXmlText(node,name,optional=false){const text=node?.[name];if(text===undefined&&optional)return undefined;if(typeof text!=='string')invalid();return text;}
export function storageXmlRows(node){return node===undefined?[]:Array.isArray(node)?node:[node];}
export function storageXmlHasError(document){
 if(!document||typeof document!=='object')return false;
 for(const[key,value]of Object.entries(document)){if(key.split(':').at(-1)==='Error')return true;if(value&&typeof value==='object'&&(Array.isArray(value)?value.some(storageXmlHasError):storageXmlHasError(value)))return true;}
 return false;
}
