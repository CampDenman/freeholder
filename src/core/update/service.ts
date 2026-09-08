// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customization seams (C10.01), channels (C10.02), signed feed (C10.03), daily check (C10.04), preflight (C10.05), apply (C10.06).
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { listed } from "@/core/contract";
import { env } from "@/core/env";
import { businessProfile } from "@/core/settings/schema";
import { PLATFORM_VERSION } from "@/core/platform";
import { defineOrchestratedService, defineService, ServiceError, type Tx } from "@/core/service";
import {
  jitterSlot,
  runUpdateCheck,
  updateCheckEnabled,
  updateFeedUrl,
} from "./check";
import instanceConfig from "../../../freeholder.config";
import { CHANNELS, RELEASE_CHANNELS } from "./channels";
import { ReleaseFeedError, verifyReleaseFeed, type VerifiedRelease } from "./feed";
import { inspectCoreFiles } from "./integrity";
import { canApplyFrom, SCHEMA_RISKS, SEVERITIES } from "./release";
import { applyUpdate as runApply, localUpdateTarget } from "./apply";
import { runPreflight } from "./preflight";
import {
  inUpdateWindow,
  isPaused,
  policyReceives,
  requiresApproval,
  shouldAutoApply,
} from "./policy";
import {
  APPLY_LEVELS,
  POLICY_CHANNELS,
  WINDOW_DAYS,
  releaseNotes,
  updateRuns,
  updateSettings,
  updateSnapshots,
} from "./schema";
import { CUSTOMIZATION_SEAMS, SEAM_IDS, type SeamId } from "./seams";
import { THIS_RELEASE } from "./this-release";
import { planForkMerge, summarizeDrift } from "./fork";
import { attemptUpstreamMerge } from "./fork-merge";
import { openForkUpdatePullRequest } from "./fork-delivery";

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

export const applyUpdate = defineOrchestratedService({
  name: "platform.applyUpdate",
  summary: "Snapshot, verify, migrate, smoke, cut over and draft a release note. Failures roll back.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    toVersion: z.string().min(1).optional(),
    digest: z.string().optional(),
    drainMs: z.number().int().min(0).max(60_000).optional(),
  }),
  output: z.object({
    id: z.string().uuid(),
    status: z.string(),
    snapshotId: z.string().uuid().nullable(),
    noteId: z.string().uuid().nullable(),
  }),
  handler: async (input, actor) => {
    if (actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to apply an update.");
    }
    const result = await runApply({
      toVersion: input.toVersion,
      digest: input.digest,
      drainMs: input.drainMs,
      trigger: "admin",
      target: localUpdateTarget,
      actor,
    });
    return { id: result.id, status: result.status, snapshotId: result.snapshotId, noteId: result.noteId };
  },
});

export const listUpdateRuns = defineService({
  name: "platform.listUpdateRuns",
  summary: "Update attempts, kept forever.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    limit: z.number().int().min(1).max(100).default(20),
  }),
  output: z.object({
    runs: listed(
      z.object({
        id: z.string().uuid(),
        fromVersion: z.string(),
        toVersion: z.string(),
        status: z.string(),
        trigger: z.string(),
        startedAt: z.date(),
      }),
    ),
    notes: listed(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        kind: z.string(),
        occurredAt: z.date(),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to read update history.");
    }
    const runs = await ctx.tx
      .select()
      .from(updateRuns)
      .orderBy(desc(updateRuns.startedAt))
      .limit(input.limit);
    const notes = await ctx.tx
      .select()
      .from(releaseNotes)
      .orderBy(desc(releaseNotes.occurredAt))
      .limit(input.limit);
    return {
      runs: runs.map((run) => ({
        id: run.id,
        fromVersion: run.fromVersion,
        toVersion: run.toVersion,
        status: run.status,
        trigger: run.trigger,
        startedAt: run.startedAt,
      })),
      notes: notes.map((note) => ({
        id: note.id,
        title: note.title,
        kind: note.kind,
        occurredAt: note.occurredAt,
      })),
    };
  },
});

const policyWindow = z.object({
  days: z.array(z.enum(WINDOW_DAYS)).min(1).max(7),
  start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
});

async function loadPolicy(tx: Tx) {
  const [row] = await tx.select().from(updateSettings).where(eq(updateSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await tx.insert(updateSettings).values({ id: 1 }).returning();
  return created!;
}

export const getUpdatePolicy = defineService({
  name: "platform.getUpdatePolicy",
  summary: "The update channel, auto-apply level, business-timezone window and snapshot retention.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    now: z.coerce.date().optional(),
  }),
  output: z.object({
    channel: z.enum(POLICY_CHANNELS),
    applyLevel: z.enum(APPLY_LEVELS),
    window: policyWindow,
    drain: z.boolean(),
    notifyChannels: listed(z.string()),
    keepSnapshots: z.number(),
    lastCheckedAt: z.date().nullable(),
    pausedUntil: z.date().nullable(),
    timezone: z.string(),
    inWindow: z.boolean(),
    paused: z.boolean(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to read the update policy.");
    }
    const row = await loadPolicy(ctx.tx);
    const [business] = await ctx.tx.select({ timezone: businessProfile.timezone }).from(businessProfile).limit(1);
    const timezone = business?.timezone || "UTC";
    const now = input.now ?? new Date();
    const policy = {
      channel: row.channel,
      applyLevel: row.applyLevel,
      window: row.window,
      drain: row.drain,
      notifyChannels: row.notifyChannels,
      keepSnapshots: row.keepSnapshots,
      lastCheckedAt: row.lastCheckedAt,
      pausedUntil: row.pausedUntil,
    };
    return {
      ...policy,
      timezone,
      inWindow: inUpdateWindow(now, timezone, row.window),
      paused: isPaused(policy, now),
    };
  },
});

export const saveUpdatePolicy = defineService({
  name: "platform.saveUpdatePolicy",
  summary: "Change the update channel, auto-apply level, window, drain and snapshot retention.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    channel: z.enum(POLICY_CHANNELS),
    applyLevel: z.enum(APPLY_LEVELS),
    window: policyWindow,
    drain: z.boolean(),
    notifyChannels: z.array(z.enum(["email", "sms"])).max(2),
    keepSnapshots: z.number().int().min(1).max(50),
    pausedUntil: z.coerce.date().nullable().optional(),
  }),
  output: z.object({
    channel: z.enum(POLICY_CHANNELS),
    applyLevel: z.enum(APPLY_LEVELS),
    keepSnapshots: z.number(),
    pruned: z.number(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Only a signed-in owner can change the update policy.");
    }
    await loadPolicy(ctx.tx);
    const [row] = await ctx.tx
      .update(updateSettings)
      .set({
        channel: input.channel,
        applyLevel: input.applyLevel,
        window: input.window,
        drain: input.drain,
        notifyChannels: input.notifyChannels,
        keepSnapshots: input.keepSnapshots,
        ...(input.pausedUntil !== undefined ? { pausedUntil: input.pausedUntil } : {}),
      })
      .where(eq(updateSettings.id, 1))
      .returning();
    const kept = row!.keepSnapshots;
    const snapshots = await ctx.tx
      .select({ id: updateSnapshots.id })
      .from(updateSnapshots)
      .orderBy(desc(updateSnapshots.createdAt));
    const extra = snapshots.slice(kept).map((snapshot) => snapshot.id);
    if (extra.length) {
      await ctx.tx.delete(updateSnapshots).where(inArray(updateSnapshots.id, extra));
    }
    return {
      channel: row!.channel,
      applyLevel: row!.applyLevel,
      keepSnapshots: kept,
      pruned: extra.length,
    };
  },
});

export const evaluateUpdatePolicy = defineService({
  name: "platform.evaluateUpdatePolicy",
  summary: "Whether a release would auto-apply or needs feature-update approval.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    channel: z.enum(RELEASE_CHANNELS),
    now: z.coerce.date().optional(),
    timezone: z.string().min(1).optional(),
  }),
  output: z.object({
    offered: z.boolean(),
    autoApply: z.boolean(),
    requiresApproval: z.boolean(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to evaluate the update policy.");
    }
    const row = await loadPolicy(ctx.tx);
    const [business] = await ctx.tx.select({ timezone: businessProfile.timezone }).from(businessProfile).limit(1);
    const timezone = input.timezone || business?.timezone || "UTC";
    const now = input.now ?? new Date();
    const policy = {
      channel: row.channel,
      applyLevel: row.applyLevel,
      window: row.window,
      drain: row.drain,
      notifyChannels: row.notifyChannels,
      keepSnapshots: row.keepSnapshots,
      lastCheckedAt: row.lastCheckedAt,
      pausedUntil: row.pausedUntil,
    };
    const release = { channel: input.channel };
    return {
      offered: policyReceives(policy.channel, input.channel),
      autoApply: shouldAutoApply(policy, release, now, timezone),
      requiresApproval: requiresApproval(policy, release),
    };
  },
});

const UPSTREAM_REMOTE = "https://github.com/CampDenman/freeholder.git";

function upstream(): { remote: string; ref: string } {
  const e = env();
  return {
    remote: e.FREEHOLDER_UPSTREAM_REMOTE ?? UPSTREAM_REMOTE,
    ref: e.FREEHOLDER_UPSTREAM_REF ?? "main",
  };
}

async function readFeedReleases(): Promise<VerifiedRelease[]> {
  const e = env();
  if (!updateCheckEnabled(e.FREEHOLDER_UPDATE_CHECK)) return [];
  try {
    const result = await runUpdateCheck({
      enabled: true,
      feedUrl: updateFeedUrl(e.FREEHOLDER_UPDATE_FEED_URL),
      fetchImpl: fetch,
    });
    return result.checked ? result.feed.releases : [];
  } catch (error) {
    // A feed this instance cannot verify is not a reason to refuse to say how
    // far a fork has drifted in commits. It is a reason not to claim it is safe.
    if (error instanceof ReleaseFeedError) return [];
    throw error;
  }
}

const missingRelease = z.object({
  version: z.string(),
  severity: z.enum(SEVERITIES),
  cvss: z.number().nullable(),
  notesUrl: z.string(),
  publishedAt: z.string(),
});

export const forkStatus = defineOrchestratedService({
  name: "platform.forkStatus",
  summary:
    "How far this fork has drifted from upstream, and which security releases it is missing.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    root: z.string().min(1).optional(),
  }),
  output: z.object({
    fork: z.boolean(),
    reason: z.string().nullable(),
    ahead: z.number(),
    behind: z.number(),
    status: z.enum(["current", "behind", "behind-security"]),
    sentence: z.string(),
    worstCvss: z.number().nullable(),
    ownedByYou: listed(z.string()),
    replaceableCore: listed(z.string()),
    missing: listed(missingRelease),
    missingSecurity: listed(missingRelease),
  }),
  handler: async (input, actor) => {
    if (actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to read fork status.");
    }
    const { remote, ref } = upstream();
    const attempt = await attemptUpstreamMerge({
      root: input.root ?? process.cwd(),
      upstreamRemote: remote,
      upstreamRef: ref,
    });
    const releases = await readFeedReleases();
    const drift = summarizeDrift({
      ahead: attempt.ahead,
      behind: attempt.behind,
      divergedPaths: attempt.divergedPaths,
      currentVersion: PLATFORM_VERSION,
      channel: THIS_RELEASE.channel,
      releases,
    });
    return {
      fork: attempt.available,
      reason: attempt.reason,
      ahead: drift.ahead,
      behind: drift.behind,
      status: drift.status,
      sentence: attempt.available
        ? drift.sentence
        : (attempt.reason ?? "This instance is not on the fork lane."),
      worstCvss: drift.worstCvss,
      ownedByYou: drift.diverged.seam,
      replaceableCore: drift.diverged.core,
      missing: drift.missing,
      missingSecurity: drift.missingSecurity,
    };
  },
});

export const openForkUpdate = defineOrchestratedService({
  name: "platform.openForkUpdate",
  summary:
    "Merge upstream in a throwaway worktree and open a pull request in this fork. Never writes to the running tree.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    root: z.string().min(1).optional(),
    toVersion: z.string().min(1).optional(),
  }),
  output: z.object({
    opened: z.boolean(),
    url: z.string().nullable(),
    branch: z.string().nullable(),
    number: z.number().nullable(),
    refusal: z.string().nullable(),
    conflicts: listed(z.object({ path: z.string(), owner: z.enum(["core", "seam", "ignored"]) })),
    ownerConflicts: listed(z.string()),
  }),
  handler: async (input, actor) => {
    if (actor.kind === "anonymous") {
      throw new ServiceError("permission", "Sign in to open a fork update.");
    }
    const { remote, ref } = upstream();
    const attempt = await attemptUpstreamMerge({
      root: input.root ?? process.cwd(),
      upstreamRemote: remote,
      upstreamRef: ref,
    });
    if (!attempt.available) {
      return {
        opened: false,
        url: null,
        branch: null,
        number: null,
        refusal: attempt.reason,
        conflicts: [],
        ownerConflicts: [],
      };
    }
    const plan = planForkMerge(attempt.conflictPaths);
    if (!plan.merges) {
      return {
        opened: false,
        url: null,
        branch: null,
        number: null,
        refusal: plan.refusal,
        conflicts: plan.conflicts,
        ownerConflicts: plan.ownerConflicts.map((conflict) => conflict.path),
      };
    }
    const toVersion = input.toVersion ?? ref;
    const pull = await openForkUpdatePullRequest({
      upstreamRef: ref,
      fromVersion: PLATFORM_VERSION,
      toVersion,
      summary:
        `Merges upstream \`${ref}\` into this fork. ` +
        `The merge was proved in a throwaway worktree before this branch existed; ` +
        `${attempt.divergedPaths.length} file(s) in this fork differ from the merge base. ` +
        "Your CI is the review.",
    });
    if (pull.conflicted) {
      return {
        opened: false,
        url: null,
        branch: pull.branch,
        number: null,
        refusal:
          `GitHub could not merge upstream cleanly. The branch \`${pull.branch}\` is left in place so you can resolve it by hand.`,
        conflicts: [],
        ownerConflicts: [],
      };
    }
    return {
      opened: true,
      url: pull.url,
      branch: pull.branch,
      number: pull.number,
      refusal: null,
      conflicts: [],
      ownerConflicts: [],
    };
  },
});

export default [
  inspectSeams,
  describeRelease,
  verifyFeed,
  updateCheckPolicy,
  checkUpdates,
  preflightUpdate,
  applyUpdate,
  listUpdateRuns,
  getUpdatePolicy,
  saveUpdatePolicy,
  evaluateUpdatePolicy,
  forkStatus,
  openForkUpdate,
];
