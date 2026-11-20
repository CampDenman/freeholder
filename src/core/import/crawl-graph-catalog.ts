// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Source-only: no public/runtime registration before full qualification.
// C3.47: one complete media plan over actual normalized HTTP entry metadata.
import type { z } from "zod";
import { assertPublicHttpUrl } from "./contract";
import { crawlPolicyAllows } from "./crawl-discovery";
import { crawlGraphHeaderSchema } from "./crawl-graph-index";
import { crawlGraphMetadataSchema } from "./crawl-index";
import { graphCatalogSchema, graphMediaPlanSchema } from "./graph-catalog";
import { planWordpressImport } from "./wordpress";

/** `policy` is supplied only after the actual saved robots object is read and
 * its original descriptor/digest is rechecked in the parent apply transaction.
 * Candidate references never authorize a network fetch or another origin.
 */
export function buildCrawlGraphCatalog(header: unknown, originals: unknown[], policy: string) {
  const head = crawlGraphHeaderSchema.parse(header), site = assertPublicHttpUrl(head.siteUrl);
  if (originals.length > 10_000 || Buffer.byteLength(JSON.stringify(originals)) > 4 * 1024 * 1024) throw new Error("The actual HTTP graph exceeds its catalog metadata budget.");
  const entries = originals.map(raw => crawlGraphMetadataSchema.parse(raw));
  if (entries.some(entry => entry.original.sourceId !== head.sourceId || entry.original.generation !== head.generation)) throw new Error("The file catalog lost its original HTTP source generation.");
  const unresolved = new Set<string>();
  const allowed = (raw: string): boolean => {
    try {
      const url = assertPublicHttpUrl(raw);
      if (url.origin === site.origin && crawlPolicyAllows(policy, url.href)) return true;
    } catch { /* Invalid source references are disclosed, never fetched. */ }
    if (unresolved.size < 100) unresolved.add(raw.slice(0, 8_192));
    return false;
  };
  const media = new Map<string, z.infer<typeof graphMediaPlanSchema>>();
  let catalogSite: z.infer<typeof graphCatalogSchema>["site"];
  if (head.kind === "wordpress-rest") {
    // Real REST record metadata supplies the references. Empty structural
    // collections do not fabricate a WXR source, WordPress ID or entity.
    const references = entries.flatMap(entry => entry.images ?? []);
    const plan = planWordpressImport({ site: { title: "", url: site.href }, items: [], attachments: [], authors: [], menus: [], menuItems: [], skipped: {} }, site.href, references, entries.map(entry => ({ wpId: entry.wpId, title: entry.title ?? "" })));
    if (plan.report.mediaOverLimit) throw new Error("The complete HTTP source exceeds its global file budget.");
    catalogSite = plan.site;
    for (const candidate of plan.media) if (allowed(candidate.sourceUrl)) media.set(candidate.key, graphMediaPlanSchema.parse(candidate));
  } else {
    catalogSite = { title: "", url: site.origin, hosts: [site.host.toLowerCase()], basePath: "" };
    for (const entry of entries) for (const candidate of entry.mediaRefs ?? []) {
      if (!allowed(candidate.sourceUrl)) continue;
      const item = graphMediaPlanSchema.parse(candidate), previous = media.get(item.key);
      if (previous && previous.sourceUrl !== item.sourceUrl) throw new Error("A shared file key refers to different original URLs.");
      // The first exact source URL remains stable across later references.
      if (!previous) media.set(item.key, item);
      else if (!previous.altText && item.altText) media.set(item.key, { ...previous, altText: item.altText });
      if (media.size > 500) throw new Error("The complete HTTP source exceeds its global file budget.");
    }
  }
  const files = [...media.values()].sort((left, right) => left.key.localeCompare(right.key));
  if (files.length > 500 || files.some(item => Buffer.byteLength(JSON.stringify(item)) > 16_384)) throw new Error("The complete original HTTP file plan exceeds its graph budget.");
  const catalog = graphCatalogSchema.parse({ site: catalogSite, menus: [], attachments: [], report: { sourceFormat: "http-originals", requests: head.requests, capturedBytes: head.capturedBytes, indexed: entries.length, unresolvedMedia: [...unresolved] } });
  if (Buffer.byteLength(JSON.stringify(catalog)) > 4 * 1024 * 1024) throw new Error("The original HTTP catalog exceeds its report budget.");
  return { catalog, media: files };
}
