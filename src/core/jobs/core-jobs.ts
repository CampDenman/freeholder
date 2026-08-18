// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core's own scheduled work.
//
// These jobs close operational debts that existed from the moment each growing
// table was introduced. That is the pattern to expect:
// tables that grow are cheap to write and only become somebody's problem
// months later, on an instance nobody is watching.
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { defineJob, pruneJobIdempotencyKeys } from "@/core/jobs";
import {
  passwordResets,
  loginSecurityEvents,
  sessions,
  staffInvitations,
  twoFactorChallenges,
} from "@/core/auth/schema";
import { rateLimitCounters } from "@/core/security/schema";
import { customerMagicLinks } from "@/core/contacts/schema";
import {
  pruneDeadLetters,
  pruneDispatched,
  redeliverOutboxEvent,
  redeliverPending,
} from "@/core/events/outbox";
import { deliverPendingSecurityNotices } from "@/core/auth/session-management/service";

/**
 * Expired sessions.
 *
 * They were deleted only when revisited, revoked, or cascaded by a user being
 * removed — so a browser that signed in once and never came back left a row
 * for as long as the instance lived. Harmless, and unbounded.
 */
export const sweepSessions = defineJob({
  name: "core.sweepSessions",
  summary: "Delete sessions that have expired.",
  schedule: "17 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(sessions)
      .where(lt(sessions.expiresAt, sql`now()`))
      .returning({ id: sessions.id });
    return { deleted: deleted.length };
  },
});

/** Suspicious-login mail is retried out of band; authentication never waits. */
export const deliverSecurityNotices = defineJob({
  name: "core.deliverSecurityNotices",
  summary: "Deliver pending suspicious-login notices.",
  schedule: "* * * * *",
  handler: () => deliverPendingSecurityNotices(),
});

/** Coarse login history has a hard 90-day retention boundary. */
export const sweepLoginSecurityEvents = defineJob({
  name: "core.sweepLoginSecurityEvents",
  summary: "Delete expired login security history.",
  schedule: "29 4 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(loginSecurityEvents)
      .where(lt(loginSecurityEvents.expiresAt, sql`now()`))
      .returning({ id: loginSecurityEvents.id });
    return { deleted: deleted.length };
  },
});

/**
 * Rate-limit counters whose window has long passed.
 *
 * Bounded by the number of distinct subjects anyone has attempted, which is
 * bounded by nothing on a site somebody is attacking.
 */
export const sweepRateLimits = defineJob({
  name: "core.sweepRateLimits",
  summary: "Delete rate-limit counters from windows that have closed.",
  schedule: "23 * * * *",
  handler: async () => {
    const deleted = await db()
      .delete(rateLimitCounters)
      .where(lt(rateLimitCounters.windowStartedAt, sql`now() - interval '1 day'`))
      .returning({ key: rateLimitCounters.key });
    return { deleted: deleted.length };
  },
});

/**
 * The outbox's crash-recovery path.
 *
 * Everything the fast path already delivered is marked, so on a healthy
 * instance this finds nothing and costs one indexed query a minute. What it
 * catches is the case the outbox exists for: a process that committed a
 * change and died before telling anybody.
 */
export const dispatchOutbox = defineJob({
  name: "core.dispatchOutbox",
  summary: "Redeliver events that were committed but never dispatched.",
  schedule: "* * * * *",
  handler: async () => {
    const result = await redeliverPending();
    if (result.redelivered > 0) {
      console.log(
        `[outbox] redelivered ${result.redelivered} event(s) a crash had stranded`,
      );
    }
    return result;
  },
});

/** Immediate, targeted recovery after an owner replays one dead letter. */
export const dispatchOutboxEvent = defineJob({
  name: "core.dispatchOutboxEvent",
  summary: "Dispatch one explicitly replayed outbox event.",
  retry: { limit: 3, delaySeconds: 15, backoff: true, maxDelaySeconds: 300 },
  concurrency: 4,
  leaseSeconds: 5 * 60,
  handler: async (data) => {
    if (typeof data.id !== "string") {
      throw new Error("core.dispatchOutboxEvent requires an event id");
    }
    return { dispatched: await redeliverOutboxEvent(data.id) };
  },
});

/**
 * Spent and expired reset links.
 *
 * They are harmless — used or out of date, neither can be redeemed — and they
 * accumulate one row per "I forgot my password" forever. The same shape of
 * problem as the sessions above, written down before it becomes somebody's
 * surprise.
 */
export const sweepPasswordResets = defineJob({
  name: "core.sweepPasswordResets",
  summary: "Delete reset links that are spent or expired.",
  schedule: "31 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(passwordResets)
      .where(
        or(
          isNotNull(passwordResets.usedAt),
          lt(passwordResets.expiresAt, sql`now() - interval '1 day'`),
        ),
      )
      .returning({ id: passwordResets.id });
    return { deleted: deleted.length };
  },
});

/** Verification attempts are short-lived credentials, not history. */
export const sweepTwoFactorChallenges = defineJob({
  name: "core.sweepTwoFactorChallenges",
  summary: "Delete spent and expired two-factor verification attempts.",
  schedule: "37 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(twoFactorChallenges)
      .where(
        or(
          isNotNull(twoFactorChallenges.usedAt),
          lt(twoFactorChallenges.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: twoFactorChallenges.id });
    return { deleted: deleted.length };
  },
});

/** Customer magic links are short-lived credentials, not account history. */
export const sweepCustomerMagicLinks = defineJob({
  name: "core.sweepCustomerMagicLinks",
  summary: "Delete used and expired customer sign-in links.",
  schedule: "43 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(customerMagicLinks)
      .where(
        or(
          isNotNull(customerMagicLinks.usedAt),
          lt(customerMagicLinks.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: customerMagicLinks.id });
    return { deleted: deleted.length };
  },
});

/**
 * Make invitation expiry explicit so the one-pending-per-address constraint
 * releases without depending on somebody opening the old link first.
 */
export const expireStaffInvitations = defineJob({
  name: "core.expireStaffInvitations",
  summary: "Mark pending staff invitations as expired when their links lapse.",
  schedule: "*/15 * * * *",
  handler: async () => {
    const expired = await db()
      .update(staffInvitations)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(staffInvitations.status, "pending"),
          lt(staffInvitations.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: staffInvitations.id });
    return { expired: expired.length };
  },
});

/** The outbox is a delivery mechanism, not a history. */
export const pruneOutbox = defineJob({
  name: "core.pruneOutbox",
  summary: "Prune delivered events and expired dead letters.",
  schedule: "41 4 * * *",
  handler: async () => ({
    dispatched: await pruneDispatched(),
    deadLetters: await pruneDeadLetters(),
  }),
});

/**
 * Send whatever is due to somebody else's server.
 *
 * Every minute, and also nudged directly by the fan-out so a delivery does not
 * wait for the tick. The schedule is what makes it *guaranteed*: an instance
 * that was restarted between an event committing and its delivery going out
 * picks the row up here, because the work list is a query rather than a
 * message somebody has to still be holding.
 */
export const deliverWebhooks = defineJob({
  name: "core.deliverWebhooks",
  summary: "Send queued webhook deliveries that are due.",
  schedule: "* * * * *",
  retry: { limit: 8, delaySeconds: 15, backoff: true, maxDelaySeconds: 3_600 },
  concurrency: 1,
  leaseSeconds: 5 * 60,
  handler: async () => {
    const { deliverDue } = await import("@/core/webhooks/deliver");
    return { attempted: await deliverDue() };
  },
});

/** The delivery log is for debugging, not for keeping. */
export const pruneWebhookDeliveries = defineJob({
  name: "core.pruneWebhookDeliveries",
  summary: "Forget webhook deliveries that finished a month ago.",
  schedule: "51 4 * * *",
  handler: async () => {
    const { pruneDeliveries } = await import("@/core/webhooks/deliver");
    return { deleted: await pruneDeliveries() };
  },
});

/**
 * Take work back from agents that went away.
 *
 * A lease is the only way to tell "still working" from "gone" across a
 * network, and an agent that dies mid-task would otherwise hold it forever.
 */
export const reapAgentLeases = defineJob({
  name: "core.reapAgentLeases",
  summary: "Reclaim tasks from agents that stopped reporting.",
  schedule: "* * * * *",
  handler: async () => {
    const { reapExpiredLeases } = await import("@/core/agents/execution");
    return reapExpiredLeases();
  },
});

/** Export artifacts are delivery files, not a second permanent copy of PII. */
export const prunePrivacyArtifacts = defineJob({
  name: "core.prunePrivacyArtifacts",
  summary: "Delete expired protected privacy-request artifacts.",
  schedule: "47 4 * * *",
  handler: async () => {
    const { pruneExpiredPrivacyArtifacts } = await import("@/core/privacy/service");
    return { deleted: await pruneExpiredPrivacyArtifacts() };
  },
});

/** Analytics is an operational signal, not a permanent person-level ledger. */
export const pruneAnalyticsEvents = defineJob({
  name: "core.pruneAnalytics",
  summary: "Prune analytics events and campaign projections at instance policy.",
  schedule: "49 4 * * *",
  handler: async () => {
    const { pruneAnalytics } = await import("@/modules/analytics/service");
    return pruneAnalytics();
  },
});

/** Browser security diagnostics are useful briefly, never permanent history. */
export const pruneContentSecurityPolicyViolations = defineJob({
  name: "core.pruneCspViolations",
  summary: "Delete expired deduplicated Content Security Policy reports.",
  schedule: "59 4 * * *",
  handler: async () => {
    const { pruneCspViolations } = await import("@/core/security/csp-reports");
    return { deleted: await pruneCspViolations() };
  },
});

/** Idempotency is bounded durable state, not an unbounded second job history. */
export const pruneJobKeys = defineJob({
  name: "core.pruneJobKeys",
  summary: "Delete expired background-job idempotency claims.",
  schedule: "53 4 * * *",
  handler: async () => ({ deleted: await pruneJobIdempotencyKeys() }),
});

/** Staged uploads and pre-commit object ledgers must never grow forever. */
export const sweepMediaOrphans = defineJob({
  name: "core.sweepMediaOrphans",
  summary: "Abort expired media uploads and remove unattached storage objects.",
  schedule: "11 * * * *",
  concurrency: 1,
  handler: async () => {
    const { cleanupOrphanedMedia } = await import("@/core/media/service");
    return cleanupOrphanedMedia();
  },
});

/** Unconfirmed recordings and leftover chunks must not outlive the session. */
export const expireCaptureSessions = defineJob({
  name: "core.expireCaptureSessions",
  summary: "Expire unconfirmed capture sessions and delete staged recordings.",
  schedule: "*/15 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireCaptureSessions: expire } = await import("@/core/media/capture");
    return expire.call({}, { kind: "system" });
  },
});

/** Trash is reversible for thirty days, then storage is reclaimed in batches. */
export const purgeExpiredMediaAssets = defineJob({
  name: "core.purgeExpiredMedia",
  summary: "Permanently purge media whose thirty-day trash window elapsed.",
  schedule: "19 5 * * *",
  concurrency: 1,
  handler: async () => {
    const { purgeExpiredMedia } = await import("@/core/media/service");
    return { purged: await purgeExpiredMedia() };
  },
});

/** Immediate external notification work, also swept after a crash. */
export const deliverNotifications = defineJob({
  name: "core.deliverNotifications",
  summary: "Deliver pending notification channels.",
  schedule: "* * * * *",
  retry: { limit: 8, delaySeconds: 15, backoff: true, maxDelaySeconds: 3_600 },
  concurrency: 1,
  leaseSeconds: 5 * 60,
  handler: async () => {
    const { deliverDueNotifications } = await import("@/core/notifications/service");
    return deliverDueNotifications();
  },
});

/** One bounded email replaces a pile of low-urgency messages. */
export const deliverNotificationDigests = defineJob({
  name: "core.deliverNotificationDigests",
  summary: "Deliver notification digests that have reached their local schedule.",
  schedule: "* * * * *",
  concurrency: 1,
  leaseSeconds: 5 * 60,
  handler: async () => {
    const { deliverDueDigests } = await import("@/core/notifications/service");
    return deliverDueDigests();
  },
});

/** Critical items get one second pass only while they remain unread. */
export const escalateNotifications = defineJob({
  name: "core.escalateNotifications",
  summary: "Escalate unread critical notifications after the personal delay.",
  schedule: "* * * * *",
  concurrency: 1,
  handler: async () => {
    const { escalateUnreadNotifications } = await import("@/core/notifications/service");
    return escalateUnreadNotifications();
  },
});

/**
 * IndexNow delta (MASTER.md §5). Enqueued by publish/rename; the handler
 * skips localhost and only posts URLs that changed.
 */
export const submitIndexNow = defineJob({
  name: "seo.submitIndexNow",
  summary: "Tell participating search engines that public URLs changed.",
  concurrency: 1,
  handler: async (data) => {
    const urls = Array.isArray(data.urls)
      ? data.urls.filter((url): url is string => typeof url === "string")
      : [];
    const { submitIndexNow: submit } = await import("@/core/seo/indexnow");
    return submit(urls);
  },
});

/** Archived inbox material is operational history, not permanent storage. */
export const deliverContributions = defineJob({
  name: "contribute.deliver",
  summary: "Deliver a submitted contribution to the configured hub.",
  retry: { limit: 6, delaySeconds: 30, backoff: true, maxDelaySeconds: 3600 },
  concurrency: 4,
  handler: async (data) => {
    const { runContributeDeliverJob } = await import("@/core/contribute/service");
    return runContributeDeliverJob(data);
  },
});

export const replyContributions = defineJob({
  name: "contribute.reply",
  summary: "Send a hub determination back to the instance that filed it.",
  retry: { limit: 6, delaySeconds: 30, backoff: true, maxDelaySeconds: 3600 },
  concurrency: 4,
  handler: async (data) => {
    const { runContributeReplyJob } = await import("@/core/contribute/service");
    return runContributeReplyJob(data);
  },
});

export const pruneOldNotifications = defineJob({
  name: "core.pruneNotifications",
  summary: "Delete notifications archived for more than one year.",
  schedule: "7 5 * * *",
  concurrency: 1,
  handler: async () => {
    const { pruneNotifications } = await import("@/core/notifications/service");
    return pruneNotifications();
  },
});

export default [
  sweepSessions,
  deliverSecurityNotices,
  sweepLoginSecurityEvents,
  sweepRateLimits,
  sweepPasswordResets,
  sweepTwoFactorChallenges,
  sweepCustomerMagicLinks,
  expireStaffInvitations,
  dispatchOutbox,
  dispatchOutboxEvent,
  pruneOutbox,
  deliverWebhooks,
  pruneWebhookDeliveries,
  reapAgentLeases,
  prunePrivacyArtifacts,
  pruneAnalyticsEvents,
  pruneContentSecurityPolicyViolations,
  pruneJobKeys,
  sweepMediaOrphans,
  expireCaptureSessions,
  purgeExpiredMediaAssets,
  deliverNotifications,
  deliverNotificationDigests,
  escalateNotifications,
  pruneOldNotifications,
  submitIndexNow,
  deliverContributions,
  replyContributions,
];
