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

/**
 * The managed workforce's heartbeat (§40): tasks are claimed, not pushed, and
 * for a managed connection this worker is the claimant. Bounded per tick;
 * anything still queued runs on the next minute.
 */
export const runManagedAgents = defineJob({
  name: "core.runManagedAgents",
  summary: "Claim and execute queued tasks for managed agent connections.",
  schedule: "* * * * *",
  concurrency: 1,
  leaseSeconds: 30 * 60,
  handler: async () => {
    const { runManagedAgentWork } = await import("@/core/agents/managed");
    return runManagedAgentWork();
  },
});

/**
 * Scheduled playbooks (C4.14).
 *
 * One job for every schedule an owner has ever written, because playbooks are
 * created at runtime and registering a pg-boss schedule per playbook would
 * mean mutating the scheduler from a request handler. The work list is a
 * range scan over one indexed timestamp, so a minute with nothing due costs
 * one query and writes nothing.
 */
export const runPlaybooks = defineJob({
  name: "core.runPlaybooks",
  summary: "Start scheduled playbooks whose next run has come round.",
  schedule: "* * * * *",
  concurrency: 1,
  leaseSeconds: 10 * 60,
  handler: async () => {
    const { runScheduledPlaybooks } = await import("@/core/agents/playbook-schedule");
    return runScheduledPlaybooks();
  },
});

/**
 * Refresh what somebody else's published calendar is blocking (C6.06).
 *
 * The path that works with no adapter at all: an owner who connected nothing
 * still has their other diary respected, because every calendar publishes one
 * of these. A feed that cannot be read leaves the last good answer in place —
 * an unreachable calendar is not an empty one.
 */
export const importCalendarFeeds = defineJob({
  name: "core.importCalendarFeeds",
  summary: "Fetch subscribed .ics feeds and refresh the time they block.",
  schedule: "*/20 * * * *",
  concurrency: 1,
  leaseSeconds: 10 * 60,
  handler: async () => {
    const { importIcsFeeds } = await import("@/core/scheduling/ics-service");
    return importIcsFeeds();
  },
});

/**
 * Let waitlist offers nobody took up go, and pass the slot on (C6.08).
 *
 * The whole promise of a held offer is that it stops being held. An offer that
 * nothing sweeps up sits on a seat indefinitely and the queue behind it never
 * moves — which is worse than no waitlist, because the business believes it
 * has one.
 */
export const expireWaitlistOffers = defineJob({
  name: "core.expireWaitlistOffers",
  summary: "Release lapsed waitlist offers and offer the slot to the next in line.",
  schedule: "*/10 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireWaitlistOffers: expire } = await import("@/core/scheduling/waitlist");
    return expire.call({}, { kind: "system" });
  },
});

/**
 * Send the appointment reminders that have come due (C6.09).
 *
 * Every five minutes, because a reminder is only worth sending near the time
 * it was meant for — an hour-before reminder that arrives forty minutes late
 * has become a different message.
 */
export const sendBookingReminders = defineJob({
  name: "core.sendBookingReminders",
  summary: "Send appointment reminders that are due, and record what happened.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { sendDueReminders } = await import("@/core/scheduling/reminders");
    return sendDueReminders();
  },
});

/**
 * Mark hires that have not come back (C6.10).
 *
 * Its own status rather than a computed one, because "overdue" is something an
 * owner acts on — a list to chase, a fee that is accruing — and a derived flag
 * that exists only while somebody is looking at the right screen is not a list.
 */
export const markOverdueHires = defineJob({
  name: "core.markOverdueHires",
  summary: "Move hires past their return time into overdue.",
  schedule: "*/30 * * * *",
  concurrency: 1,
  handler: async () => {
    const { markOverdue } = await import("@/modules/rentals/service");
    return markOverdue.call({}, { kind: "system" });
  },
});

/**
 * Let quotes past their validity lapse (C6.12).
 *
 * A swept status rather than a computed one: an expired quote is something an
 * owner follows up, and a flag that exists only while somebody is looking at
 * the right screen is not a list. Acceptance re-checks the date itself, so an
 * hourly job never decides whether a price still stands.
 */
export const expireQuotes = defineJob({
  name: "core.expireQuotes",
  summary: "Lapse quotes whose validity date has passed.",
  schedule: "17 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireQuotes: expire } = await import("@/modules/quotes/service");
    return expire.call({}, { kind: "system" });
  },
});

/**
 * Raise the recurring invoices that are due, and chase the overdue (C6.17).
 *
 * Three separate things on one schedule because they are one thought: bill
 * what recurs, mark what has gone past its date, and nudge what is unpaid. An
 * invoice that goes overdue at midnight and stays "sent" until somebody
 * presses something is not an accounts-receivable system.
 */
export const runInvoiceRoutines = defineJob({
  name: "core.runInvoiceRoutines",
  summary: "Raise recurring invoices, mark overdue ones, and send reminders.",
  schedule: "23 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runSchedules, markInvoicesOverdue, sendDueInvoiceReminders } = await import(
      "@/modules/invoicing/recurring-service"
    );
    const raised = await runSchedules.call({}, { kind: "system" });
    const overdue = await markInvoicesOverdue.call({}, { kind: "system" });
    const reminded = await sendDueInvoiceReminders();
    return { ...raised, ...overdue, reminded };
  },
});

/**
 * Bring back the conversations whose snooze has run out (C7.09).
 *
 * Every five minutes, because a snooze is a promise about a time and "back
 * within the hour" is not what somebody means when they choose nine tomorrow
 * morning. The sweep is one indexed update, so running it often costs nothing.
 */
export const wakeSnoozedThreads = defineJob({
  name: "core.wakeSnoozedThreads",
  summary: "Reopen conversations whose snooze has expired.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { wakeSnoozedConversations } = await import("@/core/messaging/inbox");
    return wakeSnoozedConversations();
  },
});

/**
 * Nudge whoever asked to be nudged (C7.02).
 *
 * Every ten minutes rather than hourly, because a reminder is a promise about
 * a time: somebody who asked to be told at nine wants it at nine, not at the
 * top of whichever hour comes next. The sweep claims its work in the statement
 * that finds it, so running often costs nothing and sends nothing twice.
 */
export const sendTaskReminders = defineJob({
  name: "core.sendTaskReminders",
  summary: "Tell people about the tasks they asked to be reminded of.",
  schedule: "*/10 * * * *",
  concurrency: 1,
  handler: async () => {
    const { sendTaskReminders: send } = await import("@/core/tasks/service");
    return send();
  },
});

/**
 * Read connected mailboxes for who has been in touch (C4.18).
 *
 * Hourly, not by the minute: this is about who wrote to the business, and a
 * correspondent who appeared forty minutes ago is not news the CRM has to have
 * this second. It also keeps a first sync of a busy mailbox to one bounded
 * batch an hour rather than a rush at a provider's rate limit.
 */
export const importConnectedMail = defineJob({
  name: "core.importConnectedMail",
  summary: "Read connected mailboxes and fold correspondents into contacts.",
  schedule: "27 * * * *",
  concurrency: 1,
  leaseSeconds: 20 * 60,
  handler: async () => {
    const { importDueMailboxes } = await import("@/core/connections/mail-import");
    return importDueMailboxes();
  },
});

/**
 * The daily briefing, built before anybody arrives (C4.15).
 *
 * Hourly rather than at one fixed time: the business's chosen hour is read
 * from its own timezone, and an instance that was asleep at that hour still
 * produces the day's briefing at the next tick rather than skipping the day.
 * Re-assembly replaces the day's sections, so running twice is harmless.
 */
export const assembleBriefings = defineJob({
  name: "core.assembleBriefings",
  summary: "Assemble each person's daily briefing.",
  schedule: "5 * * * *",
  concurrency: 1,
  leaseSeconds: 15 * 60,
  handler: async () => {
    const { assembleDueBriefings } = await import("@/core/briefing/service");
    return assembleDueBriefings();
  },
});

/** An approval nobody answers lapses instead of sitting pending forever. */
export const expireAgentApprovals = defineJob({
  name: "core.expireAgentApprovals",
  summary: "Lapse expired managed-write approvals and release their tasks.",
  schedule: "7 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireApprovals } = await import("@/core/agents/writes");
    return expireApprovals.call({}, { kind: "system" });
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

/**
 * Keep external calendars in step (C4.12).
 *
 * Every quarter hour, because a booking page that offers a slot somebody
 * filled ten minutes ago is the failure this exists to prevent, and because a
 * cursor makes the poll cost roughly nothing when nothing changed.
 */
export const syncExternalCalendars = defineJob({
  name: "core.syncExternalCalendars",
  summary: "Refresh busy time from connected Google and Microsoft calendars.",
  schedule: "*/15 * * * *",
  concurrency: 1,
  leaseSeconds: 10 * 60,
  handler: async () => {
    const { syncDueCalendarAccounts } = await import("@/core/connections/calendar-sync");
    const result = await syncDueCalendarAccounts();
    return { synced: result.synced, failed: result.failed };
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
  expireAgentApprovals,
  runPlaybooks,
  assembleBriefings,
  runManagedAgents,
  purgeExpiredMediaAssets,
  deliverNotifications,
  deliverNotificationDigests,
  escalateNotifications,
  pruneOldNotifications,
  syncExternalCalendars,
  importConnectedMail,
  importCalendarFeeds,
  expireWaitlistOffers,
  sendBookingReminders,
  markOverdueHires,
  runInvoiceRoutines,
  expireQuotes,
  sendTaskReminders,
  wakeSnoozedThreads,
  submitIndexNow,
  deliverContributions,
  replyContributions,
];
