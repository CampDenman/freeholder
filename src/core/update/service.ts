// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Report whether this instance still honours the customization contract (C10.01).
import { z } from "zod";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { listed } from "@/core/contract";
import { env } from "@/core/env";
import { PLATFORM_VERSION } from "@/core/platform";
import { defineService, ServiceError } from "@/core/service";
import instanceConfig from "../../../freeholder.config";
import { inspectCoreFiles } from "./integrity";
import { CUSTOMIZATION_SEAMS, SEAM_IDS, type SeamId } from "./seams";

const seamStatus = z.object({
  id: z.enum(SEAM_IDS),
  holds: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  detail: z.string(),
});

export const inspectSeams = defineService({
  name: "platform.inspectSeams",
  summary: "Whether owner data, plugins, configuration and uploads sit outside replaceable core.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    root: z.string().min(1).optional(),
  }),
  output: z.object({
    version: z.string(),
    seams: listed(seamStatus),
    core: z.object({
      digest: z.string(),
      expected: z.string().nullable(),
      matches: z.boolean().nullable(),
      modified: listed(z.string()),
      supported: z.boolean(),
    }),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to inspect this instance's update seams.");
    }
    const root = input.root ?? process.cwd();
    const e = env();
    const configPath = join(/* turbopackIgnore: true */ root, "freeholder.config.ts");
    const configPresent = await access(/* turbopackIgnore: true */ configPath).then(
      () => true,
      () => false,
    );
    const storage = instanceConfig.adapters.storage;
    const uploads = uploadsStatus(storage, e.NODE_ENV, e.FREEHOLDER_UNSAFE_LOCAL_STORAGE === "1");
    const core = await inspectCoreFiles({
      root,
      expectedDigest: e.FREEHOLDER_CORE_DIGEST ?? null,
      hash: true,
    });
    const seams: { id: SeamId; holds: string; status: "ok" | "warn" | "fail"; detail: string }[] =
      CUSTOMIZATION_SEAMS.map((seam) => {
        if (seam.id === "database") {
          return {
            id: seam.id,
            holds: seam.holds,
            status: "ok" as const,
            detail: "Business records live in Postgres, not in the image.",
          };
        }
        if (seam.id === "plugins") {
          return {
            id: seam.id,
            holds: seam.holds,
            status: "ok" as const,
            detail: "Installed plugins sit in plugins/ and are never merged into core.",
          };
        }
        if (seam.id === "configuration") {
          return {
            id: seam.id,
            holds: seam.holds,
            status: configPresent ? ("ok" as const) : ("fail" as const),
            detail: configPresent
              ? "freeholder.config.ts is outside replaceable core."
              : "freeholder.config.ts is missing, so this instance has no declared choices.",
          };
        }
        return { id: seam.id, holds: seam.holds, ...uploads };
      });
    return { version: PLATFORM_VERSION, seams, core };
  },
});

function uploadsStatus(
  storage: string,
  nodeEnv: string,
  unsafeLocal: boolean,
): { status: "ok" | "warn" | "fail"; detail: string } {
  if (storage !== "local") {
    return {
      status: "ok",
      detail: `Uploads use ${storage} object storage, not instance disk.`,
    };
  }
  if (nodeEnv !== "production") {
    return {
      status: "ok",
      detail: "Local disk storage is for development. Production must use object storage.",
    };
  }
  if (unsafeLocal) {
    return {
      status: "warn",
      detail: "Uploads are on this machine's disk because FREEHOLDER_UNSAFE_LOCAL_STORAGE=1.",
    };
  }
  return {
    status: "fail",
    detail: "Uploads are configured for local disk in production, which does not survive a rebuild.",
  };
}

export default [inspectSeams];
