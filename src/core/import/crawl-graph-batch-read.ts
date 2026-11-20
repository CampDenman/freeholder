// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Source-only HTTP commit path; full lifecycle qualification remains required.
// C3.47: prepare a bounded child from distinct actual HTTP originals.
import { createHash } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { readCrawlOriginalBody, type CrawlBodyDescriptor } from "./crawl-body";
import { crawlGraphMetadataSchema } from "./crawl-index";
import type { graphCatalogSchema, graphMediaPlanSchema } from "./graph-catalog";
import { genericPlanSchema, parseGenericHtml, stageGenericPages } from "./generic-plan";
import { stageWordpressExport } from "./service";
import { wordpressExportFromRest } from "./wordpress";

export type CrawlBatchEntry = { id: string; ordinal: number; startByte: number; endByte: number; digest: string; metadata: unknown; targetSlug: string | null };
export type CrawlBatchOriginal = { descriptor: CrawlBodyDescriptor; requestId: string; requestOrdinal: number; role: "html" | "rest-pages" | "rest-posts"; requestedUrl: string; entryMetadata: unknown };
export type CrawlBatchReadClaim = {
  kind: "content" | "media"; sourceKind: "wordpress-rest" | "html" | "sitemap" | "rss" | "atom";
  origin: string; entries: CrawlBatchEntry[]; originals: CrawlBatchOriginal[];
  catalog: z.infer<typeof graphCatalogSchema>; media: z.infer<typeof graphMediaPlanSchema>[];
};
const sha=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const feed=z.object({url:z.string().url(),title:z.string(),publishedAt:z.string().optional(),status:z.enum(["draft","publish"]).optional(),kind:z.literal("post").optional()});

/** The real private claim must supply these descriptors by normalized FK,
 * including source generation/revision and accepted physical facts. This read
 * helper is outside the provider-free claim/apply transaction pair.
 */
export async function prepareCrawlGraphBatch(claim:CrawlBatchReadClaim) {
  if(claim.entries.length>500||claim.originals.length>500)throw new ServiceError("validation","This original HTTP batch exceeds its entry budget.");
  const originals=new Map(claim.originals.map(original=>[original.descriptor.responseId,original]));
  if(originals.size!==claim.originals.length||claim.originals.reduce((total,original)=>total+original.descriptor.bytes,0)>20*1024*1024)throw new ServiceError("validation","This original HTTP batch exceeds its physical read budget.");
  if(claim.kind==="media"&&(claim.entries.length||claim.originals.length||claim.media.length!==1))throw new ServiceError("conflict","A file-only batch must retain exactly its one reviewed shared file.");
  const bodies=new Map<string,Uint8Array>();
  for(const original of claim.originals)bodies.set(original.descriptor.responseId,await readCrawlOriginalBody(original.descriptor));
  const records:unknown[]=[], genericPages:ReturnType<typeof parseGenericHtml>[]=[];
  for(const entry of claim.entries){
    const metadata=crawlGraphMetadataSchema.parse(entry.metadata), ref=metadata.original, original=originals.get(ref.responseId),body=bodies.get(ref.responseId);
    if(!original||!body||ref.runId!==original.descriptor.runId||ref.sourceId!==original.descriptor.sourceId||ref.generation!==original.descriptor.generation||ref.requestId!==original.requestId||ref.requestOrdinal!==original.requestOrdinal||ref.role!==original.role||ref.requestedUrl!==original.requestedUrl||ref.digest!==original.descriptor.digest||ref.bytes!==original.descriptor.bytes||ref.start!==entry.startByte||ref.end!==entry.endByte||entry.startByte<0||entry.endByte<=entry.startByte||entry.endByte>body.byteLength)throw new ServiceError("conflict","The bounded child lost its actual response-local source binding.");
    const local=body.slice(entry.startByte,entry.endByte);
    if(sha(local)!==entry.digest)throw new ServiceError("conflict","The actual original HTTP record digest changed.");
    const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(local);
    if(claim.sourceKind==="wordpress-rest"){
      if(!["rest-pages","rest-posts"].includes(original.role))throw new ServiceError("conflict","The original WordPress batch lost its real collection kind.");
      records.push(JSON.parse(text));
    }else{
      if(original.role!=="html"||entry.startByte!==0||entry.endByte!==body.byteLength||metadata.wpId!==undefined)throw new ServiceError("conflict","A rendered page must retain its actual complete response without a fabricated WordPress identity.");
      const parsed=parseGenericHtml(text,original.requestedUrl),actualFeed=original.entryMetadata===null?null:feed.parse(original.entryMetadata);
      if(actualFeed&&actualFeed.url!==original.requestedUrl)throw new ServiceError("conflict","The rendered original lost its actual feed metadata.");
      genericPages.push({...parsed,...(actualFeed?{title:actualFeed.title,kind:"post" as const,...(actualFeed.publishedAt?{publishedAt:actualFeed.publishedAt}:{}),...(actualFeed.status?{status:actualFeed.status}:{})}:{})});
    }
  }
  const result=claim.sourceKind==="wordpress-rest"
    ?stageWordpressExport(wordpressExportFromRest(records,claim.origin),claim.origin)
    :stageGenericPages(genericPages,claim.origin);
  const staged = { preview: result.preview as Record<string, unknown>, counts: result.counts as Record<string, number> };
  const pages=staged.preview.pages as Array<Record<string,unknown>>;
  const byWpId=new Map(claim.entries.flatMap(entry=>typeof object(entry.metadata).wpId==="string"?[[String(object(entry.metadata).wpId),entry] as const]:[]));
  const byUrl=new Map(claim.entries.map(entry=>[String(object(entry.metadata).url),entry]));
  for(const page of pages){
    const entry=typeof page.wpId==="string"?byWpId.get(page.wpId):byUrl.get(String(page.url));
    if(!entry||entry.targetSlug===null)throw new ServiceError("conflict","The bounded child lost its global source-to-target mapping.");
    page.slug=entry.targetSlug;
    const sourcePath=object(entry.metadata).sourcePath;
    if(typeof sourcePath==="string"&&sourcePath&&sourcePath!==entry.targetSlug)page.redirectFrom=sourcePath;
  }
  if(claim.sourceKind==="wordpress-rest"){
    const wordpress=object(staged.preview.wordpress),referenced=new Set((wordpress.media as Array<{key:string;referenced:boolean}>).filter(item=>item.referenced).map(item=>item.key));
    wordpress.media=claim.kind==="media"?claim.media:claim.media.filter(item=>referenced.has(item.key));
    wordpress.menus=[];wordpress.attachments=[];staged.preview.wordpress=wordpress;
    staged.counts.media=(wordpress.media as unknown[]).length;
  }else{
    const generic=genericPlanSchema.parse(staged.preview.generic),referenced=new Set(generic.media.filter(item=>item.referenced).map(item=>item.key));
    generic.media=claim.kind==="media"?claim.media:claim.media.filter(item=>referenced.has(item.key));
    staged.preview.generic=generic;staged.counts.media=generic.media.length;
  }
  return staged;
}
