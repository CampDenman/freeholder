// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Internal orchestration is registered for composition, never projected as an
// HTTP/API-key/OpenAPI/LLM/MCP capability.
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi } from "@/core/api/openapi";
import { contractProjections } from "@/core/contract/projections";
import { ready } from "@/core/runtime";
import {
  getExternalService,
  getService,
  listExternalServices,
  listServices,
  type Actor,
} from "@/core/service";
import { hiddenFromMcp, serviceForTool, toolName, toolsFor } from "@/mcp/tools";

const INTERNAL = [
  "ads.rollUpStats",
  "agents.runDuePlaybooks",
  "agents.startEventPlaybooks",
  // The wake sweep (C9.02). System rather than scoped because a sleeping run
  // is woken by a job on nobody's behalf, and it needs a real ServiceContext:
  // advancing a run dispatches verbs through `ctx.callAsSystem` and queues
  // events, neither of which a plain function can do.
  "automations.wake",
  "briefing.agentAttention",
  "briefing.appointments",
  "briefing.assemble",
  "briefing.playbookSection",
  "briefing.reconnects",
  "briefing.tasks",
  "briefing.update",
  "briefing.webhookFailures",
  // Sending a campaign (C9.06). Starting one is scoped — an owner presses
  // send — but carrying it forward is not: `sendNext` and `tick` run from
  // `newsletters.tickBroadcasts` a batch at a time, on nobody's behalf, long
  // after the request that started it has ended.
  "broadcasts.sendNext",
  "broadcasts.tick",
  // Provider work is split around short system-only snapshot/apply services.
  // These names are implementation seams for workers, never public verbs.
  "catalogue.applyRefresh",
  "catalogue.refreshSource",
  "entitlements.issuePass",
  "entitlements.issueUnlock",
  "entitlements.syncSubscription",
  "entitlements.syncTier",
  "forms.briefingEnquiries",
  "galleries.buildArchive",
  "galleries.expireSessions",
  "invoicing.briefingOverdue",
  "mail.applySenderVerification",
  "mail.recordProviderEvent",
  "media.backfillWatermarks",
  "media.purgeExpired",
  "media.registerStoredOriginal",
  "messaging.applySmsEvents",
  "notifications.create",
  "referrals.claimTouches",
  "social.applyGbpReviews",
  "social.applyIngestedProfilePost",
  "social.applyProfileHealth",
  "social.gbpHoursSource",
  "social.gbpProfileIds",
  "social.gbpProfileSource",
  "social.healthProfileSource",
  "social.healthProfiles",
  "social.ingestProfileIds",
  "social.ingestProfileSource",
  "social.ingestedPost",
  "social.publicationSource",
  "social.recordGbpHours",
  "social.recordProfileIngest",
  "social.recordPublicationResult",
  // The renewal sweep (C9.13). System because a period ending is not
  // something anybody did: a job finds what is due and raises the invoice on
  // nobody's behalf, long after the person who subscribed has gone.
  "subscriptions.renewDue",
  // The dunning sweep (C9.16). System because a retry offset expiring is not
  // something anybody did: a job finds who is past due and sends the notice
  // or takes the final action on nobody's behalf.
  "subscriptions.advanceDunning",
  "subscriptions.recoverDunning",
] as const;

const wildcard: Actor = {
  kind: "agent",
  keyName: "boundary-test",
  scopes: [
    "*",
    "agents.*",
    "briefing.*",
    "forms.*",
    "invoicing.*",
    "mail.*",
    "media.*",
    "messaging.*",
    "notifications.*",
  ],
};

describe("the system-service boundary", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);

  it("keeps an explicit reviewed inventory", () => {
    const actual = [...listServices().values()]
      .filter((service) => service.def.permission === "system")
      .map((service) => service.def.name)
      .sort();
    expect(actual).toEqual([...INTERNAL].sort());
  });

  it("keeps every internal service out of every generated projection", () => {
    const openapi = buildOpenApi({
      origin: "https://example.test",
      version: "0.1.0",
      title: "Boundary test",
    });
    const paths = openapi.paths as Record<string, unknown>;
    const projections = contractProjections();
    const tools = new Set(toolsFor(wildcard).map((tool) => tool.name));

    for (const name of INTERNAL) {
      const service = getService(name);
      expect(service.def.permission).toBe("system");
      expect(hiddenFromMcp(service)).toBe(true);
      expect(listExternalServices().has(name)).toBe(false);
      expect(paths).not.toHaveProperty(`/api/v1/${name}`);
      expect(projections.names).not.toContain(name);
      expect(projections.openapiPaths).not.toContain(`/api/v1/${name}`);
      expect(tools.has(toolName(name))).toBe(false);
      expect(serviceForTool(wildcard, toolName(name))).toBeUndefined();
    }
  });

  it("answers an external name probe exactly like an unknown service", () => {
    for (const name of INTERNAL) {
      let refusal: unknown;
      try {
        getExternalService(name);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: "not_found" });
    }
  });
});
