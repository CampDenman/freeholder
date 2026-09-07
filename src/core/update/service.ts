// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customization seams (C10.01), channels (C10.02), signed feed (C10.03), daily check (C10.04), preflight (C10.05).
import { z } from "zod";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { listed } from "@/core/contract";
import { env } from "@/core/env";
import { PLATFORM_VERSION } from "@/core/platform";
import { defineOrchestratedService, defineService, ServiceError } from "@/core/service";
import {
  jitterSlot,
  runUpdateCheck,
  updateCheckEnabled,
  updateFeedUrl,
} from "./check";
import instanceConfig from "../../../freeholder.config";
import { CHANNELS, RELEASE_CHANNELS } from "./channels";
import { ReleaseFeedError, verifyReleaseFeed } from "./feed";
import { inspectCoreFiles } from "./integrity";
import { canApplyFrom, SCHEMA_RISKS, SEVERITIES } from "./release";
import { runPreflight } from "./preflight";
import { CUSTOMIZATION_SEAMS, SEAM_IDS, type SeamId } from "./seams";
import { THIS_RELEASE } from "./this-release";

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
    const storage = e.FREEHOLDER_STORAGE ?? instanceConfig.adapters.storage;
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
            status: "ok" as const,
            detail: configPresent
              ? "freeholder.config.ts sits outside replaceable core."
              : "Instance configuration is loaded separately from replaceable runtime files.",
          };
        }
        return { id: seam.id, holds: seam.holds, ...uploads };
      });
    return { version: PLATFORM_VERSION, seams, core };
  },
});

const manualStep = z.object({
  id: z.string(),
  summary: z.string(),
});

export const describeRelease = defineService({
  name: "platform.describeRelease",
  summary: "Declared channel, compatibility, schema risk, CVSS and manual steps for this build.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    fromVersion: z.string().min(1).optional(),
  }),
  output: z.object({
    version: z.string(),
    channel: z.enum(RELEASE_CHANNELS),
    minFromVersion: z.string(),
    schemaRisk: z.enum(SCHEMA_RISKS),
    cvss: z.number().nullable(),
    severity: z.enum(SEVERITIES),
    manualSteps: listed(manualStep),
    pluginApi: z.string(),
    channels: listed(
      z.object({
        id: z.enum(RELEASE_CHANNELS),
        holds: z.string(),
      }),
    ),
    apply: z
      .object({
        fromVersion: z.string(),
        ok: z.boolean(),
        reason: z.string(),
      })
      .nullable(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to read this instance's release metadata.");
    }
    const apply = input.fromVersion
      ? { fromVersion: input.fromVersion, ...canApplyFrom(input.fromVersion, THIS_RELEASE) }
      : null;
    return {
      version: THIS_RELEASE.version,
      channel: THIS_RELEASE.channel,
      minFromVersion: THIS_RELEASE.minFromVersion,
      schemaRisk: THIS_RELEASE.schemaRisk,
      cvss: THIS_RELEASE.cvss,
      severity: THIS_RELEASE.severity,
      manualSteps: THIS_RELEASE.manualSteps,
      pluginApi: THIS_RELEASE.pluginApi,
      channels: CHANNELS.map((channel) => ({ id: channel.id, holds: channel.holds })),
      apply,
    };
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

export const verifyFeed = defineService({
  name: "platform.verifyReleaseFeed",
  summary: "Verify a signed releases.json against the keys this instance ships. A bad signature is a hard stop.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    feed: z.unknown(),
  }),
  output: z.object({
    keyId: z.string(),
    signedAt: z.string(),
    releases: listed(
      z.object({
        version: z.string(),
        channel: z.enum(RELEASE_CHANNELS),
        digest: z.string(),
        image: z.string(),
        notesUrl: z.string(),
        schemaRisk: z.enum(SCHEMA_RISKS),
        cvss: z.number().nullable(),
        severity: z.enum(SEVERITIES),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to verify a release feed.");
    }
    try {
      const verified = verifyReleaseFeed(input.feed);
      return {
        keyId: verified.keyId,
        signedAt: verified.signedAt,
        releases: verified.releases.map((release) => ({
          version: release.version,
          channel: release.channel,
          digest: release.digest,
          image: release.image,
          notesUrl: release.notesUrl,
          schemaRisk: release.schemaRisk,
          cvss: release.cvss,
          severity: release.severity,
        })),
      };
    } catch (error) {
      const message =
        error instanceof ReleaseFeedError
          ? error.message
          : "This release feed is not signed by a trusted Freeholder key. Refusing to read it. This is not a warning.";
      throw new ServiceError("validation", message);
    }
  },
});

export const updateCheckPolicy = defineService({
  name: "platform.updateCheckPolicy",
  summary: "Whether this instance checks the signed update feed, and that it never reports upstream.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    enabled: z.boolean(),
    feedUrl: z.string(),
    reports: z.literal(false),
    slot: z.number(),
  }),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to read the update-check policy.");
    }
    const e = env();
    return {
      enabled: updateCheckEnabled(e.FREEHOLDER_UPDATE_CHECK),
      feedUrl: updateFeedUrl(e.FREEHOLDER_UPDATE_FEED_URL),
      reports: false as const,
      slot: jitterSlot(e.APP_URL),
    };
  },
});

export const checkUpdates = defineOrchestratedService({
  name: "platform.checkUpdates",
  summary: "GET the signed update feed. Sends no instance identifier.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    checked: z.boolean(),
    reason: z.enum(["off", "slot"]).nullable(),
    keyId: z.string().nullable(),
    releases: listed(
      z.object({
        version: z.string(),
        channel: z.enum(RELEASE_CHANNELS),
        digest: z.string(),
        severity: z.enum(SEVERITIES),
      }),
    ),
  }),
  handler: async (_input, actor) => {
    if (actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to check for updates.");
    }
    const e = env();
    const result = await runUpdateCheck({
      enabled: updateCheckEnabled(e.FREEHOLDER_UPDATE_CHECK),
      feedUrl: updateFeedUrl(e.FREEHOLDER_UPDATE_FEED_URL),
      fetchImpl: fetch,
    });
    if (!result.checked) {
      return { checked: false, reason: result.reason, keyId: null, releases: [] };
    }
    return {
      checked: true,
      reason: null,
      keyId: result.feed.keyId,
      releases: result.feed.releases.map((release) => ({
        version: release.version,
        channel: release.channel,
        digest: release.digest,
        severity: release.severity,
      })),
    };
  },
});

export const preflightUpdate = defineOrchestratedService({
  name: "platform.preflightUpdate",
  summary: "Verify signatures, plugins, drift, environment and a shadow-schema migration before applying an update.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    feed: z.unknown().optional(),
    targetVersion: z.string().min(1).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    estimatedDowntimeMs: z.number(),
    steps: listed(
      z.object({
        id: z.string(),
        verdict: z.enum(["ok", "warn", "fail"]),
        detail: z.string(),
      }),
    ),
  }),
  handler: async (input, actor) => {
    if (actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to run update preflight.");
    }
    return runPreflight({ feed: input.feed, targetVersion: input.targetVersion });
  },
});

export default [inspectSeams, describeRelease, verifyFeed, updateCheckPolicy, checkUpdates, preflightUpdate];
