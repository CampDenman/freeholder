// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: one bounded private capture/discovery phase over actual HTTP originals.
// Source-only: not registered until privacy, recovery and the normal81 migration.
import { z } from "zod";
import { boundStorage } from "@/adapters/storage";
import { putWithReceipt } from "@/core/media/write-ledger";
import { defineOrchestratedService, ServiceError } from "@/core/service";
import { readCrawlOriginalBody } from "./crawl-body";
import { acceptCrawlObject, admitCrawlFetch, applyCrawlDiscovery, authorizeCrawlFetch, claimCrawlCapture, recordCrawlResponse, rememberCrawlCaptureFailure, sealOriginalCrawl } from "./crawl-capture";
import { crawlPolicyAllows, discoverCrawlPhase } from "./crawl-discovery";
import { claimCrawlGraphIndex, applyCrawlGraphIndex } from "./crawl-graph-index";
import { claimCrawlGraphCatalog, applyCrawlGraphCatalog } from "./crawl-graph-plan";
import { indexCrawlOriginalResponse } from "./crawl-index";
import { crawlOriginalFactsSchema } from "./crawl-original";
import { readCrawlOriginalResponse } from "./crawl-original";
import { recordCrawlWrapperFinish } from "./crawl-finish";

export const advanceCrawl = defineOrchestratedService({
  name: "imports.advanceCrawl",
  summary: "Save one original HTTP response or continue its bounded saved frontier. Nothing is published.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  rateLimit: { limit: 600, windowSeconds: 3600, subject: input => input.id, message: "This saved import has advanced repeatedly. Wait briefly before continuing." },
  input: z.object({ id: z.uuid(), generation: z.uuid() }),
  output: z.object({ id: z.uuid(), generation: z.uuid(), step: z.enum(["captured", "discovered", "blocked", "idle", "recovery", "indexed", "previewed"]) }),
  handler: async (input, actor) => {
    const deadline = Date.now() + 60_000, captured = await boundStorage();
    if (captured.store.isPublic) throw new ServiceError("conflict", "Original HTTP responses require private object storage.");
    const claim = await claimCrawlCapture.call({ ...input, storageNamespace: captured.binding.namespace }, actor);
    if (claim.kind === "recovery") return { ...input, step: "recovery" as const };
    if (claim.kind === "catalog") {
      const review = await claimCrawlGraphCatalog.call(input, actor);
      if (!review.planned) {
        if (!review.leaseToken) throw new ServiceError("conflict", "The original file-review phase lost its lease.");
        const body = await readCrawlOriginalBody(review.policy);
        // Apply verifies the actual bytes before decoding a200 policy. A404
        // body is retained as fact, including non-text error bodies.
        if (Date.now() > deadline) throw new ServiceError("conflict", "This original-policy review exceeded its bounded deadline.");
        await applyCrawlGraphCatalog.call({ ...input, graphId: review.graphId, leaseToken: review.leaseToken, policy: review.policy, policyBody: body }, actor);
      }
      return { ...input, step: "previewed" as const };
    }
    if (claim.kind === "idle" || claim.kind === "index") {
      if (claim.kind === "idle") await sealOriginalCrawl.call(input, actor);
      const phase = await claimCrawlGraphIndex.call(input, actor);
      let entries: Awaited<ReturnType<typeof indexCrawlOriginalResponse>>["entries"] = [], physicalBytes = 0;
      if (phase.source) {
        const request = phase.request, response = phase.response;
        if (!request || !response || !["html", "rest-pages", "rest-posts"].includes(request.role)) throw new ServiceError("conflict", "The original content response lost its private index claim.");
        const body = await readCrawlOriginalBody(phase.source);
        const indexed = await indexCrawlOriginalResponse({ siteUrl: phase.siteUrl, source: phase.source, request: { ...request, role: request.role as "html" | "rest-pages" | "rest-posts" }, facts: crawlOriginalFactsSchema.parse(response.facts), ordinal: phase.previous.ordinal }, body);
        entries = indexed.entries; physicalBytes = indexed.physicalBytes;
      }
      if (Date.now() > deadline) throw new ServiceError("conflict", "This original-response index phase exceeded its bounded deadline.");
      await applyCrawlGraphIndex.call({ ...input, graphId: phase.graphId, leaseToken: phase.leaseToken, sourceRevision: phase.sourceRevision, previous: phase.previous, nextRequestOrdinal: phase.nextRequestOrdinal, source: phase.source, entries, physicalBytes }, actor);
      return { ...input, step: "indexed" as const };
    }
    const phase = { ...input, requestId: claim.request.id, responseId: claim.response.id, leaseToken: claim.leaseToken };
    if (!claim.source.siteUrl || !claim.source.sourceUrl || !claim.request.url) throw new ServiceError("conflict", "The original public source was invalidated.");
    if (claim.kind === "discover") {
      const facts = claim.response.facts;
      if (!facts) throw new ServiceError("conflict", "The captured original response facts need recovery.");
      const body = await readCrawlOriginalBody({ runId: input.id, sourceId: claim.source.id, generation: input.generation, responseId: claim.response.id, digest: facts.digest, bytes: facts.bytes });
      const plan = discoverCrawlPhase({ kind: claim.source.kind, siteUrl: claim.source.siteUrl, sourceUrl: claim.source.sourceUrl }, claim.request, facts, body, claim.response.discoveryOrdinal);
      if (Date.now() > deadline) throw new ServiceError("conflict", "This bounded discovery phase exceeded its original deadline.");
      await applyCrawlDiscovery.call({ ...phase, digest: facts.digest, ...plan }, actor);
      return { ...input, step: "discovered" as const };
    }
    try {
      let allowed = true;
      if (claim.policy) {
        const body = await readCrawlOriginalBody(claim.policy);
        // A real404 means no robots policy. Its actual response bytes still
        // remain captured and budgeted; error-page text is never a policy.
        allowed = claim.policyStatus === 404 || crawlPolicyAllows(new TextDecoder("utf-8", { fatal: true }).decode(body), claim.request.url);
      }
      const admitted = await admitCrawlFetch.call({ ...phase, allowed, robotsResponseId: claim.policy?.responseId ?? null, robotsDigest: claim.policy?.digest ?? null }, actor);
      if (!admitted.admitted) return { ...input, step: "blocked" as const };
      if (admitted.waitMs > 0) await new Promise<void>(resolve => setTimeout(resolve, admitted.waitMs));
      if (Date.now() >= deadline) throw new ServiceError("conflict", "This bounded source phase exceeded its original deadline.");
      await authorizeCrawlFetch.call(phase, actor);
      const original = await readCrawlOriginalResponse({ site: claim.source.siteUrl, url: claim.request.url, role: claim.request.role, ...(claim.request.restPage === null ? {} : { page: claim.request.restPage }) }, { remainingBytes: claim.response.reservedBytes, deadline });
      const admittedObject = await recordCrawlResponse.call({ ...phase, facts: original.facts }, actor);
      if (admittedObject.namespace !== captured.binding.namespace) throw new ServiceError("conflict", "Restore the original private storage resource before continuing this response.");
      await putWithReceipt({ key: admittedObject.key, body: original.body, contentType: original.facts.contentType || "application/octet-stream", role: "staged", requiresReservation: true }, actor, captured);
      await acceptCrawlObject.call(phase, actor);
      return { ...input, step: "captured" as const };
    } catch {
      // This recovery phase may itself refuse a revoked caller. The original
      // claimed row and independent physical receipt still remain durable.
      await rememberCrawlCaptureFailure.call(phase, actor).catch(() => undefined);
      throw new ServiceError("conflict", "The original HTTP response needs verified recovery before this crawl can continue.");
    } finally {
      // This executes after the actual GET/PUT wrapper has returned or thrown.
      // A missing finish fact remains recovery debt; no clock/GET infers it.
      await recordCrawlWrapperFinish.call({ responseId: claim.response.id, token: claim.leaseToken }, { kind: "system" }).catch(() => undefined);
    }
  },
});
