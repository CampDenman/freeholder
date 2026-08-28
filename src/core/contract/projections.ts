// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every machine projection of the registry, from one function (C3.06).
import { buildOpenApi } from "@/core/api/openapi";
import { PLATFORM_VERSION } from "@/core/platform";
import { listExternalServices } from "@/core/service";
import { hiddenFromMcp, toolName } from "@/mcp/tools";

export function contractProjections() {
  const services = [...listExternalServices().values()].sort((a, b) =>
    a.def.name.localeCompare(b.def.name),
  );
  const names = services.map((service) => service.def.name);
  const openapi = buildOpenApi({
    origin: "https://example.invalid",
    version: PLATFORM_VERSION,
    title: "Freeholder",
  });
  const openapiPaths = Object.keys(openapi.paths as object).sort((a, b) =>
    a.localeCompare(b),
  );
  const mcpTools = services
    .filter((service) => !hiddenFromMcp(service))
    .map((service) => toolName(service.def.name))
    .sort();
  return { names, openapi, openapiPaths, mcpTools };
}

export function humanReference(): string {
  const { names, openapi } = contractProjections();
  const lines = [
    `# Freeholder contract`,
    ``,
    `Platform ${PLATFORM_VERSION}. ${names.length} services.`,
    ``,
    `Live documents: \`/api/openapi.json\`, \`/api/mcp\`, \`/llms-full.txt\`.`,
    ``,
  ];
  const paths = openapi.paths as Record<string, { post?: { summary?: string } }>;
  for (const name of names) {
    const summary = paths[`/api/v1/${name}`]?.post?.summary ?? "";
    lines.push(`- \`${name}\` — ${summary}`);
  }
  return `${lines.join("\n")}\n`;
}

export function llmsContractSection(): string {
  const { names } = contractProjections();
  return [
    "## Platform contract",
    "",
    `This instance is Freeholder ${PLATFORM_VERSION}.`,
    "Machine contract: GET /api/openapi.json",
    "Agent tools: POST /api/mcp (JSON-RPC, Bearer API key)",
    `Services: ${names.join(", ")}`,
    "",
  ].join("\n");
}
