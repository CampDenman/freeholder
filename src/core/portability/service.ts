// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Instance version, compatibility and one-command export (C3.18, C3.20).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { listed, okResult, row } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { CONTRACT, PLATFORM_VERSION } from "@/core/platform";
import { pluginFitsPlatform } from "@freeholder/plugin-kit";
import { installedPlugins } from "@/core/plugins/schema";
import instanceConfig from "../../../freeholder.config";
import {
  createOwnershipExport,
  EXPORT_FORMAT,
} from "./ownership-export.mjs";
import { TIER1_TARGETS } from "./archive";

export const platformVersion = defineService({
  name: "platform.version",
  summary: "The truthful instance version for health, admin, CLI and contract.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: row({
    version: z.string(),
    contract: z.object({
      openapi: z.string(),
      mcpProtocol: z.string(),
      webhookSchema: z.number(),
    }),
    exportFormat: z.string(),
    targets: listed(z.string()),
  }),
  handler: async () => ({
    version: PLATFORM_VERSION,
    contract: CONTRACT,
    exportFormat: EXPORT_FORMAT,
    targets: [...TIER1_TARGETS],
  }),
});

export const platformCompatibility = defineService({
  name: "platform.compatibility",
  summary: "Whether each installed plugin still fits this platform version.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: row({
    version: z.string(),
    compatible: z.boolean(),
    plugins: listed(
      row({
        name: z.string(),
        version: z.string(),
        freeholder: z.string(),
        fits: z.boolean(),
      }),
    ),
  }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx.select().from(installedPlugins);
    const plugins = rows.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      freeholder: plugin.freeholder,
      fits: pluginFitsPlatform(plugin.freeholder, PLATFORM_VERSION),
    }));
    return {
      version: PLATFORM_VERSION,
      compatible: plugins.every((plugin) => plugin.fits),
      plugins,
    };
  },
});

export const exportOwnership = defineService({
  name: "platform.export",
  summary: "One-command full export of normalized data without secrets.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    outputDirectory: z.string().min(1).optional(),
  }),
  output: okResult.extend({
    format: z.string(),
    directory: z.string(),
    files: z.number(),
    checksum: z.string().optional(),
  }),
  handler: async (input) => {
    const directory =
      input.outputDirectory ?? (await mkdtemp(join(tmpdir(), "freeholder-export-")));
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new ServiceError("validation", "DATABASE_URL is required to export this instance.");
    }
    const result = (await createOwnershipExport({
      databaseUrl,
      outputDirectory: directory,
      configuration: {
        filename: "freeholder.config.json",
        contents: `${JSON.stringify(instanceConfig, null, 2)}\n`,
      },
    })) as unknown as {
      manifest: { files?: Array<{ sha256: string }>; tableCount: number };
    };
    return {
      ok: true as const,
      format: EXPORT_FORMAT,
      directory,
      files: result.manifest.files?.length ?? result.manifest.tableCount,
      checksum: result.manifest.files?.[0]?.sha256,
    };
  },
});

export default [platformVersion, platformCompatibility, exportOwnership];
