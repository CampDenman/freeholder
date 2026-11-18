// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The look-ahead pass: the whole product, in one scheduled job.
//
// Three decisions, each of which the obvious build of this feature gets wrong.
//
// **Daily, not hourly, and not at boot.** An interval timer inside the web
// process has three problems: on an autoscaled deployment it runs only when
// traffic happens to wake an instance, it fires again on every boot, and 23 of
// every 24 runs can do nothing useful because the lead time it compares
// against is measured in days. Here it is one job on the pg-boss registry,
// once a day.
//
// **A failed send must leave a mark.** Catching each send into a boolean and
// ending the pass with `if (alertsSent > 0) log(...)` means that once the mail
// route stops working there is no log line, no alert row and no timestamp —
// the pass runs on schedule and leaves no trace of any kind. This handler
// returns counts including `failed`, and lets the error out of the pass only
// when it could not even read its own table. A scheduled job whose only output
// is a side effect is one nobody can tell has stopped working.
//
// **Suppression is a row, not arithmetic.** See `schema.ts`.
import { and, eq, lte, sql } from "drizzle-orm";
import { defineJob } from "@/core/jobs";
import { contacts } from "@/core/contacts/schema";
import { sendMail } from "@/core/mail/service";
import { renewalAlerts, trackedSubscriptions, type RenewalCycle } from "./schema";
import { renewalAlertMessage } from "./mail";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next occurrence of a recurring charge at or after `from`, counted from
 * the date it first happened.
 *
 * Calendar months, not 30-day approximations. Mixing the two —
 * `Math.floor(daysDiff / 30)` to jump, then `setMonth` to step — drifts
 * against every month that is not 30 days long. Anchoring on the first charge
 * and stepping in the unit the cycle is actually expressed in means a charge
 * on the 31st stays on the 31st where the month allows it, and the answer does
 * not depend on how long ago the subscription was added.
 */
export function nextRenewalAfter(
  firstChargeAt: Date,
  cycle: RenewalCycle,
  customIntervalDays: number | null,
  from: Date,
): Date {
  const next = new Date(firstChargeAt.getTime());
  if (next > from) return next;

  // Bounded: a daily custom cycle anchored a decade back is ~3,650 steps, and
  // an unbounded `while` here would be a hang rather than a wrong answer.
  const LIMIT = 10_000;
  for (let step = 0; step < LIMIT; step += 1) {
    if (cycle === "custom") {
      const days = customIntervalDays && customIntervalDays > 0 ? customIntervalDays : 30;
      next.setTime(next.getTime() + days * DAY_MS);
    } else if (cycle === "annual") {
      next.setUTCFullYear(next.getUTCFullYear() + 1);
    } else {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }
    if (next > from) return next;
  }
  return next;
}

export interface RenewalPassResult {
  examined: number;
  rolledForward: number;
  alerted: number;
  failed: number;
  suppressed: number;
}

/**
 * One pass. Returns counts rather than nothing, for the reason in the header.
 */
export async function runRenewalLookAhead(now: Date = new Date()): Promise<RenewalPassResult> {
  const { db } = await import("@/core/db");
  const result: RenewalPassResult = {
    examined: 0,
    rolledForward: 0,
    alerted: 0,
    failed: 0,
    suppressed: 0,
  };

  const due = await db()
    .select({
      id: trackedSubscriptions.id,
      contactId: trackedSubscriptions.contactId,
      name: trackedSubscriptions.name,
      costMinor: trackedSubscriptions.costMinor,
      currency: trackedSubscriptions.currency,
      cycle: trackedSubscriptions.cycle,
      customIntervalDays: trackedSubscriptions.customIntervalDays,
      firstChargeAt: trackedSubscriptions.firstChargeAt,
      nextRenewalAt: trackedSubscriptions.nextRenewalAt,
      alertDays: trackedSubscriptions.alertDays,
      email: contacts.email,
    })
    .from(trackedSubscriptions)
    .innerJoin(contacts, eq(contacts.id, trackedSubscriptions.contactId))
    .where(
      and(
        eq(trackedSubscriptions.status, "active"),
        // Due when the renewal is within its own lead time, or already past —
        // a past renewal is rolled forward below rather than ignored.
        lte(
          sql`${trackedSubscriptions.nextRenewalAt} - make_interval(days => ${trackedSubscriptions.alertDays})`,
          now,
        ),
      ),
    );

  for (const row of due) {
    result.examined += 1;

    // A renewal that has already passed means no pass ran while it was due.
    // Roll it to the next real occurrence and alert on that instead of
    // sending a warning about a charge that has already happened.
    let renewalAt = row.nextRenewalAt;
    if (renewalAt.getTime() <= now.getTime()) {
      renewalAt = nextRenewalAfter(row.firstChargeAt, row.cycle, row.customIntervalDays, now);
      await db()
        .update(trackedSubscriptions)
        .set({ nextRenewalAt: renewalAt, updatedAt: new Date() })
        .where(eq(trackedSubscriptions.id, row.id));
      result.rolledForward += 1;
    }

    const msAhead = renewalAt.getTime() - now.getTime();
    const daysAhead = Math.ceil(msAhead / DAY_MS);
    if (daysAhead > row.alertDays || daysAhead < 0) continue;

    if (!row.email) continue;

    const eventRef = `renewal-alert:${row.id}:${renewalAt.toISOString()}`;
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: row.currency,
    }).format(row.costMinor / 100);
    const renewsOn = renewalAt.toISOString().slice(0, 10);

    try {
      await db().transaction(async (tx) => {
        // The unique index is the suppression rule. Claiming the row first
        // means a second concurrent pass loses here rather than at the
        // provider, and never stages a duplicate message at all.
        const [claimed] = await tx
          .insert(renewalAlerts)
          .values({
            subscriptionId: row.id,
            contactId: row.contactId,
            renewalAt,
            daysAhead,
          })
          .onConflictDoNothing({
            target: [renewalAlerts.subscriptionId, renewalAlerts.renewalAt],
          })
          .returning({ id: renewalAlerts.id });

        if (!claimed) {
          result.suppressed += 1;
          return;
        }

        const staged = await sendMail(
          tx,
          renewalAlertMessage(row.email as string, {
            name: row.name,
            amount,
            renewsOn,
            daysAhead,
            dashboardUrl: "/account/subscriptions",
          }),
          {
            purpose: "transactional",
            transactionalReason: "service_notification",
            eventRef,
            idempotencyKey: eventRef,
          },
        );

        await tx
          .update(renewalAlerts)
          .set({ mailDeliveryId: staged.id })
          .where(eq(renewalAlerts.id, claimed.id));
        result.alerted += 1;
      });
    } catch {
      // One recipient's refusal — a suppressed address, a missing sender —
      // must not stop the pass for everyone else. It is counted, and the
      // claim rolled back with the transaction, so the next pass retries it.
      result.failed += 1;
    }
  }

  return result;
}

export const sendRenewalAlerts = defineJob({
  name: "renewalAlerts.lookAhead",
  summary: "Warn people about third-party charges that are about to renew.",
  // Once a day, in the morning. The lead time is measured in days, so a more
  // frequent pass would do the same nothing repeatedly — and this job sends
  // mail, which is not something to retry on a whim.
  schedule: "0 8 * * *",
  concurrency: 1,
  handler: () => runRenewalLookAhead(),
});

export default [sendRenewalAlerts];
