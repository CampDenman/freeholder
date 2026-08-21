// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What this instance is actually running (MASTER.md §37, C4.22).
//
// §37: "An instance that modifies itself must still be able to say exactly
// what it is running. Its `/source` route emits the base version, applied
// plugins, license and notices, and the diff its builder produced."
//
// The reason it exists is worth stating precisely, because it is easy to
// misread as a licence obligation. Apache-2.0 does **not** require an operator
// to publish private modifications merely because they run them over a
// network. This route is for owner control, reproducibility, audit and correct
// attribution — an instance that can rewrite itself and cannot say what it now
// is would be a black box the owner owns on paper only.
//
// Because it is not a licence obligation, it is not public. What it exposes —
// which plugins are installed, what the builder was asked to change — is a map
// of the instance, and a map is what somebody attacking it would want first.
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listed, timestamp, uuid } from "@/core/contract";
import { defineService, getService, ServiceError } from "@/core/service";
import { builderCodeProposals, builderProposals } from "@/modules/builder/schema";

/** Read once: the licence does not change while the process runs. */
let licenceCache: string | null = null;

async function licenceText(): Promise<string> {
  if (licenceCache !== null) return licenceCache;
  try {
    licenceCache = await readFile(join(process.cwd(), "LICENSE"), "utf8");
  } catch {
    // A deployment that dropped the file still says which licence applies;
    // it just cannot quote it.
    licenceCache = "";
  }
  return licenceCache;
}

export const sourceProvenance = defineService({
  name: "platform.source",
  summary: "The running version, its plugins, its licence, and what the builder changed.",
  kind: "query",
  // Owner-facing, not public: this is a map of the instance.
  permission: "scoped",
  input: z.object({
    /** The licence text is long; a screen usually wants the identifier only. */
    includeLicenceText: z.boolean().default(false),
    changeLimit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.object({
    version: z.string(),
    license: z.string(),
    licenseText: z.string().nullable(),
    notices: listed(
      z.object({ name: z.string(), license: z.string(), note: z.string().nullable() }),
    ),
    plugins: listed(
      z.object({
        name: z.string(),
        version: z.string(),
        status: z.string(),
        license: z.string().nullable(),
        permissions: z.array(z.string()),
      }),
    ),
    builderChanges: listed(
      z.object({
        id: uuid,
        lane: z.enum(["structure", "code"]),
        summary: z.string(),
        status: z.string(),
        /** Where a code change went, so it can be found in the repository. */
        reference: z.string().nullable(),
        actor: z.string(),
        at: timestamp,
      }),
    ),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to see what this instance is running.");
    }

    // Plugins are read through their own service so this cannot drift from
    // what the platform actually loaded.
    let plugins: {
      name: string;
      version: string;
      status: string;
      license: string | null;
      permissions: string[];
    }[] = [];
    try {
      const installed = (await ctx.call(getService("plugins.list"), {})) as {
        name: string;
        version: string;
        status: string;
        license?: string | null;
        permissions?: string[];
      }[];
      plugins = installed.map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        status: plugin.status,
        license: plugin.license ?? null,
        permissions: plugin.permissions ?? [],
      }));
    } catch {
      plugins = [];
    }

    const structure = await ctx.tx
      .select({
        id: builderProposals.id,
        summary: builderProposals.summary,
        status: builderProposals.status,
        actor: builderProposals.createdByActor,
        at: builderProposals.createdAt,
      })
      .from(builderProposals)
      // Only what was actually applied. A proposal nobody accepted did not
      // change what this instance is.
      .where(sql`${builderProposals.status} in ('applied', 'rolled_back')`)
      .orderBy(desc(builderProposals.createdAt))
      .limit(input.changeLimit);

    const code = await ctx.tx
      .select({
        id: builderCodeProposals.id,
        summary: builderCodeProposals.summary,
        status: builderCodeProposals.status,
        reference: builderCodeProposals.pullRequestUrl,
        actor: builderCodeProposals.createdByActor,
        at: builderCodeProposals.createdAt,
      })
      .from(builderCodeProposals)
      .where(eq(builderCodeProposals.status, "delivered"))
      .orderBy(desc(builderCodeProposals.createdAt))
      .limit(input.changeLimit);

    const builderChanges = [
      ...structure.map((change) => ({
        ...change,
        lane: "structure" as const,
        reference: null,
      })),
      ...code.map((change) => ({ ...change, lane: "code" as const })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, input.changeLimit);

    return {
      version: process.env.npm_package_version ?? "0.0.0",
      license: "Apache-2.0",
      licenseText: input.includeLicenceText ? await licenceText() : null,
      // Third-party material keeps its own licence and notice (LICENSING.md).
      notices: plugins
        .filter((plugin) => plugin.license && plugin.license !== "Apache-2.0")
        .map((plugin) => ({
          name: plugin.name,
          license: plugin.license!,
          note: "Installed plugin; retains its own licence and notice.",
        })),
      plugins,
      builderChanges,
    };
  },
});

export default [sourceProvenance];
