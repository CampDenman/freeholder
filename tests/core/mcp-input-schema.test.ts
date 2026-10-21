// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.04: ordinary optional scheduling dates must not erase the whole tool.
import { afterEach, expect, it } from "vitest";
import { registerService, resetRegistryForTests } from "@/core/service";
import { saveBroadcast } from "@/modules/newsletters/broadcast-service";
import { toolsFor } from "@/mcp/tools";

afterEach(resetRegistryForTests);

it("describes campaign scheduling inputs without a database or provider", () => {
  registerService(saveBroadcast);
  const [tool] = toolsFor({ kind: "agent", keyName: "Newsletter assistant", scopes: ["broadcasts.save"] });
  expect(tool).toBeDefined();
  const schema = tool!.inputSchema as { required: string[]; properties: { scheduledAt: { anyOf: unknown[] } } };
  expect(schema.required).toEqual(["name", "templateId", "segmentId"]);
  expect(schema.properties.scheduledAt.anyOf).toContainEqual({ type: "string", format: "date-time" });
});
