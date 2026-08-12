// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Static accessibility and native-control contract for the notification inbox.
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  DigestSettingsForm,
  MarkAllRead,
  NotificationItemActions,
  PreferencesForm,
  type ControlLabels,
} from "../../app/(admin)/admin/notifications/NotificationControls";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";

const labels: ControlLabels = {
  markRead: "Mark read",
  markUnread: "Mark unread",
  archive: "Archive",
  markAllRead: "Mark all read",
  save: "Save changes",
  saving: "Saving",
  saved: "Saved",
  modes: { immediate: "Immediate", digest: "Digest", off: "Off" },
};

function page(): string {
  const controls = renderToStaticMarkup(createElement(Fragment, {},
    createElement(MarkAllRead, { labels }),
    createElement("article", {},
      createElement("h2", {}, "A connection needs attention"),
      createElement("p", {}, "Reconnect the calendar."),
      createElement(NotificationItemActions, {
        id: "00000000-0000-4000-8000-000000000010",
        read: false,
        labels,
      }),
    ),
    createElement(PreferencesForm, {
      rows: [{
        topic: "connections.attention",
        label: "Connections needing attention",
        values: { in_app: "immediate", email: "digest", sms: "off", push: "off" },
      }],
      available: { in_app: true, email: true, sms: false, push: false },
      labels,
      topicLabel: "Topic",
      channelLabels: { in_app: "In-app", email: "Email", sms: "SMS", push: "Push" },
    }),
    createElement(DigestSettingsForm, {
      values: {
        digestCadence: "daily",
        digestMinute: 480,
        digestWeekday: 1,
        timezone: "America/Vancouver",
        escalationMinutes: 60,
      },
      labels,
      fields: {
        cadence: "Digest cadence",
        daily: "Daily",
        weekly: "Weekly",
        weekday: "Weekly delivery day",
        weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        time: "Delivery time",
        timezone: "Timezone",
        escalation: "Escalation delay",
        escalationHint: "Unread critical items get one additional pass.",
      },
    }),
  ));
  return `<!doctype html><html lang="en"><head><title>Notifications</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Notifications</h1>${controls}</main></body></html>`;
}

describe("notification controls markup", () => {
  it("passes the static accessibility gate", async () => {
    const result = await auditHtml(page(), "https://example.test/admin/notifications");
    expect(result.violations).toEqual([]);
  });

  it("uses native forms, labelled controls and a real preference table", () => {
    const document = new JSDOM(page()).window.document;
    expect(document.querySelectorAll("form")).toHaveLength(4);
    expect(document.querySelectorAll("button[type=submit]").length).toBeGreaterThanOrEqual(5);
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect(document.querySelectorAll("th[scope=col]")).toHaveLength(5);
    expect(document.querySelectorAll("th[scope=row]")).toHaveLength(1);
    expect(document.querySelectorAll("select[aria-label]")).toHaveLength(4);
    expect(document.querySelectorAll("select:disabled")).toHaveLength(2);
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(1);
    expect(document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveLength(0);
    for (const label of document.querySelectorAll("label[for]")) {
      expect(document.getElementById(label.getAttribute("for")!)).not.toBeNull();
    }
  });
});
