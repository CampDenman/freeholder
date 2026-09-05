// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Hourly health probe so token expiry surfaces before post time (C9.24).
import { defineJob } from "@/core/jobs";

export const socialHealth = defineJob({
  name: "social.health",
  summary: "Probe connected social profiles and warn before tokens expire.",
  schedule: "7 * * * *",
  concurrency: 1,
  handler: async (_data, context) => {
    const { runHealthJob } = await import("./service");
    return runHealthJob(context);
  },
});

export const socialHealthProfile = defineJob({
  name: "social.healthProfileOne",
  summary: "Probe and record one social provider grant outside a service transaction.",
  concurrency: 2,
  leaseSeconds: 2 * 60,
  handler: async (data, context) => {
    if (typeof data.profileId !== "string") {
      throw new Error("social.healthProfileOne requires a profile id");
    }
    const { runProfileHealth } = await import("./service");
    return runProfileHealth(data.profileId, context);
  },
});

export const socialIngest = defineJob({
  name: "social.ingest",
  summary: "Pull owned posts and comments from every readable profile.",
  schedule: "37 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runIngestJob } = await import("./ingest");
    return runIngestJob();
  },
});

export const socialIngestProfile = defineJob({
  name: "social.ingestProfileOne",
  summary: "Pull owned posts and comments from one readable social profile.",
  concurrency: 1,
  leaseSeconds: 10 * 60,
  handler: async (data, context) => {
    if (typeof data.profileId !== "string") {
      throw new Error("social.ingestProfileOne requires a profile id");
    }
    const { runProfileIngest } = await import("./ingest");
    return runProfileIngest(data.profileId, context);
  },
});

export const socialPublish = defineJob({
  name: "social.publishDue",
  summary: "Publish scheduled social variants whose time has come.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runPublishJob } = await import("./compose");
    return runPublishJob();
  },
});

export const socialGbp = defineJob({
  name: "social.gbpSync",
  summary: "Sync Google Business Profile posts, hours and reviews.",
  schedule: "17 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runGbpJob } = await import("./gbp");
    return runGbpJob();
  },
});

export const socialPublishPublication = defineJob({
  name: "social.publishPublication",
  summary: "Deliver one approved social publication outside a service transaction.",
  concurrency: 2,
  leaseSeconds: 5 * 60,
  retry: { limit: 5, delaySeconds: 30, backoff: true, maxDelaySeconds: 30 * 60 },
  handler: async (data, context) => {
    if (typeof data.publicationId !== "string") {
      throw new Error("social.publishPublication requires a publication id");
    }
    const { runPublication } = await import("./compose");
    return runPublication(data.publicationId, context);
  },
});

export const socialGbpProfile = defineJob({
  name: "social.gbpProfileOne",
  summary: "Run one durable Google Business Profile synchronization workflow.",
  concurrency: 1,
  leaseSeconds: 10 * 60,
  handler: async (data, context) => {
    if (
      typeof data.profileId !== "string" ||
      !["all", "hours", "reviews"].includes(String(data.operation)) ||
      (data.locationId !== undefined && typeof data.locationId !== "string")
    ) {
      throw new Error("social.gbpProfileOne received invalid sync data");
    }
    const { runGbpSync } = await import("./gbp");
    return runGbpSync(
      data.profileId,
      data.operation as "all" | "hours" | "reviews",
      data.locationId,
      context,
    );
  },
});

export default [
  socialHealth,
  socialHealthProfile,
  socialIngest,
  socialIngestProfile,
  socialPublish,
  socialPublishPublication,
  socialGbp,
  socialGbpProfile,
];
