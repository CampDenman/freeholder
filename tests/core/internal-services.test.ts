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
  "agents.runDuePlaybooks",
  "agents.startEventPlaybooks",
  "briefing.agentAttention",
  "briefing.appointments",
  "briefing.assemble",
  "briefing.playbookSection",
  "briefing.reconnects",
  "briefing.tasks",
  "briefing.update",
  "briefing.webhookFailures",
  "forms.briefingEnquiries",
  "galleries.expireSessions",
  "invoicing.briefingOverdue",
  "mail.recordProviderEvent",
  "media.backfillWatermarks",
  "media.purgeExpired",
  "media.registerStoredOriginal",
  "messaging.applySmsEvents",
  "notifications.create",
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
  });

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
