// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one message this module sends.
//
// Two things the original got wrong and this does not.
//
// **It sends a plain-text part.** `OutboundEmail` makes `text` mandatory and
// calls HTML "an enhancement, never the only copy", which is the right way
// round: a text/plain part is what a screen reader, a text client and a spam
// filter all read. An HTML-only notice reads as empty to all three.
//
// **It does not sell anything.** An advert in a renewal alert is the obvious
// way to monetise one, and it cannot be done honestly here: a paid placement
// makes the message marketing, and marketing needs a direct opt-in for a named
// topic plus List-Unsubscribe headers, which this message does not carry
// because it is a service notification. A provider adapter that checks the
// permission declaration refuses a marketing send that arrives mislabelled, so
// the only way an advert could ride along is by lying to it. It is not a
// template decision; it is why the template has no slot.
import type { OutboundEmail } from "@/adapters/mail/types";

export interface RenewalAlertCopy {
  name: string;
  amount: string;
  renewsOn: string;
  daysAhead: number;
  dashboardUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain words. Someone reads this on a phone, half-awake, before a charge. */
export function renewalAlertMessage(to: string, copy: RenewalAlertCopy): OutboundEmail {
  const days = copy.daysAhead === 1 ? "tomorrow" : `in ${copy.daysAhead} days`;
  const subject = `${copy.name} renews ${days} — ${copy.amount}`;
  const text = [
    `${copy.name} renews ${days}, on ${copy.renewsOn}.`,
    ``,
    `Amount: ${copy.amount}`,
    ``,
    `If you still want it, do nothing.`,
    `If you don't, cancel it before ${copy.renewsOn}.`,
    ``,
    `Your subscriptions: ${copy.dashboardUrl}`,
    ``,
    `You get this because you asked us to watch ${copy.name} for you.`,
  ].join("\n");

  const html = [
    `<p><strong>${escapeHtml(copy.name)}</strong> renews ${escapeHtml(days)}, on ${escapeHtml(copy.renewsOn)}.</p>`,
    `<p style="font-size:24px;margin:16px 0;"><strong>${escapeHtml(copy.amount)}</strong></p>`,
    `<p>If you still want it, do nothing. If you don't, cancel it before ${escapeHtml(copy.renewsOn)}.</p>`,
    `<p><a href="${escapeHtml(copy.dashboardUrl)}">Your subscriptions</a></p>`,
    `<p style="color:#6b7280;font-size:12px;">You get this because you asked us to watch ${escapeHtml(copy.name)} for you.</p>`,
  ].join("\n");

  return { to, subject, text, html };
}
