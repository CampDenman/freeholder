// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// OpenAPI, MCP and the written contract describe the same registry (C3.02, C3.06).
import { afterAll, describe, expect, it } from "vitest";
import { contractProjections, humanReference, llmsContractSection } from "@/core/contract/projections";
import { PLATFORM_VERSION } from "@/core/platform";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase } from "../helpers/spine";

describe.runIf(hasDatabase)("contract projections (C3.02, C3.06)", () => {
  afterAll(closeDb);

  it("keeps OpenAPI paths, the registry and MCP tools in lockstep", async () => {
    await ready();
    const { names, openapi, openapiPaths, mcpTools } = contractProjections();
    expect(openapiPaths).toEqual(names.map((name) => `/api/v1/${name}`));
    const info = openapi.info as { version: string; "x-freeholder": { platformVersion: string; webhookSchemaVersion: number } };
    expect(info.version).toBe(PLATFORM_VERSION);
    const meta = info["x-freeholder"];
    expect(meta.platformVersion).toBe(PLATFORM_VERSION);
    expect(meta.webhookSchemaVersion).toBe(1);
    expect(openapi.webhooks).toHaveProperty("freeholderEvent");
    expect((openapi.components as { schemas: { FreeholderEvent: unknown } }).schemas.FreeholderEvent).toBeTruthy();

    const create = (openapi.paths as Record<string, { post: { security: unknown[]; responses: Record<string, unknown> } }>)[
      "/api/v1/contacts.create"
    ]!.post;
    expect(create.security).toEqual([{ bearerAuth: [] }]);
    expect(create.responses["500"]).toBeTruthy();

    const publicOp = (openapi.paths as Record<string, { get: { security: unknown[] } }>)[
      "/api/v1/settings.getBusiness"
    ]!.get;
    expect(publicOp.security).toEqual([]);

    for (const tool of mcpTools) {
      expect(names).toContain(tool.replace(/_/g, "."));
    }
    expect(mcpTools).not.toContain("auth_login");
    expect(humanReference()).toContain("contacts.create");
    expect(llmsContractSection()).toContain("/api/openapi.json");
  });
});
