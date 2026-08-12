// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Static accessibility/keyboard contract for Admin → Settings → Mail.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  MailSettingsCard,
  type MailLabels,
} from "../../app/(admin)/admin/settings/MailSettingsCard";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";

const labels: MailLabels = {
  title: "Mail delivery",
  intro: "Keep account mail separate from campaigns.",
  route: "Delivery route",
  transactional: "Account mail",
  transactionalIntro: "Receipts and password resets.",
  bulk: "Broadcast mail",
  bulkIntro: "Campaigns with delivery feedback.",
  provider: "Provider",
  delivers: "Ready to send",
  notDelivering: "Not ready to send",
  configured: "Configured",
  incomplete: "Needs setup",
  notConfigured: "Set a From address.",
  missing: "Add these settings:",
  connectGoogle: "Connect Google",
  connectMicrosoft: "Connect Microsoft",
  register: "Register configured sender",
  senderEmail: "Configured sender address",
  displayName: "Sender name",
  providerIdentity: "Provider identity",
  providerIdentityHint: "Optional provider identity.",
  webhook: "Feedback URL",
  feedbackReady: "feedback authenticated",
  feedbackMissing: "feedback incomplete",
  senders: "Registered senders",
  noSenders: "No sender registered.",
  default: "Default",
  chooseDefault: "Make default",
  verify: "Check verification",
  recheck: "Recheck",
  pause: "Pause",
  reactivate: "Reactivate",
  test: "Send test",
  verified: "Verified",
  pending: "Verification pending",
  failed: "Failed verification",
  active: "Active",
  paused: "Paused",
  needsAttention: "Needs attention",
  needsReconnect: "Reconnect",
  revoked: "Authorization revoked",
  permissionOff: "Send permission off",
  lastChecked: "Last checked",
  recentDeliveries: "Recent delivery evidence",
  noDeliveries: "No deliveries.",
  recipient: "Recipient",
  subject: "Subject",
  status: "Status",
  attempts: "Attempts",
  when: "When",
  suppressions: "Suppressed addresses",
  suppressionIntro: "Verify an address before release.",
  noSuppressions: "No suppressions.",
  reason: "Reason",
  release: "Release suppression",
  releaseHint: "Type the exact address.",
  confirmation: "Type the exact address",
  readOnly: "You can inspect but not change mail.",
  actionDone: "Mail setting updated.",
  pendingAction: "Working…",
  deliveryStatuses: {
    queued: "Queued",
    submitted: "Submitted",
    delivered: "Delivered",
    bounced: "Bounced",
    complained: "Complaint",
    failed: "Failed",
    suppressed: "Suppressed",
  },
  suppressionReasons: {
    hard_bounce: "Permanent bounce",
    complaint: "Spam complaint",
    provider: "Provider suppression",
    manual: "Manual block",
  },
};

const props = {
  configuration: {
    transactional: {
      provider: "smtp" as const,
      delivers: true,
      missing: [],
      fromAddress: "hello@example.test",
    },
    oauth: [
      { provider: "google" as const, configured: true, missing: [] },
      {
        provider: "microsoft" as const,
        configured: false,
        missing: ["MICROSOFT_OAUTH_CLIENT_ID"],
      },
    ],
    bulk: {
      provider: "resend" as const,
      sendConfigured: true,
      feedbackConfigured: true,
      missing: [],
      webhookPath: "/api/mail/webhooks/resend",
      fromAddress: "news@example.test",
    },
  },
  senders: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      purpose: "transactional" as const,
      provider: "smtp" as const,
      email: "hello@example.test",
      displayName: "Business",
      verificationStatus: "verified" as const,
      status: "active" as const,
      isDefault: true,
      lastVerified: "Aug 12, 2026, 12:00 PM",
      lastError: null,
      accountStatus: null,
      capabilityEnabled: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000011",
      purpose: "bulk" as const,
      provider: "resend" as const,
      email: "news@example.test",
      displayName: null,
      verificationStatus: "verified" as const,
      status: "active" as const,
      isDefault: true,
      lastVerified: "Aug 12, 2026, 12:00 PM",
      lastError: null,
      accountStatus: null,
      capabilityEnabled: null,
    },
  ],
  deliveries: [
    {
      id: "00000000-0000-4000-8000-000000000020",
      provider: "resend",
      recipient: "customer@example.test",
      subject: "A receipt",
      status: "delivered",
      attempts: 1,
      detail: null,
      when: "Aug 12, 2026, 12:00 PM",
    },
  ],
  suppressions: [
    {
      email: "blocked@example.test",
      reason: "hard_bounce",
      provider: "resend",
      detail: "Resend permanent bounce",
      when: "Aug 12, 2026, 12:00 PM",
    },
  ],
  labels,
};

function page(canManage = true): string {
  const content = renderToStaticMarkup(
    createElement(MailSettingsCard, { ...props, canManage }),
  );
  return `<!doctype html><html lang="en"><head><title>Mail settings</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Settings</h1>${content}</main></body></html>`;
}

describe("mail settings markup", () => {
  it("passes the static accessibility gate", async () => {
    const result = await auditHtml(page(), "https://example.test/admin/settings");
    expect(result.violations).toEqual([]);
  });

  it("uses native keyboard controls with unique labels and no positive tab order", () => {
    const document = new JSDOM(page()).window.document;
    expect(document.querySelectorAll("button").length).toBeGreaterThanOrEqual(8);
    expect(document.querySelectorAll('input[type="email"]').length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveLength(0);
    expect(document.querySelectorAll("label:not([for])")).toHaveLength(0);
    for (const label of document.querySelectorAll("label[for]")) {
      const id = label.getAttribute("for")!;
      expect(Array.from(document.querySelectorAll("[id]")).filter((node) => node.id === id)).toHaveLength(1);
    }
    const table = document.querySelector("table");
    expect(table?.querySelectorAll("th[scope=col]")).toHaveLength(6);
  });

  it("removes every mutation control for a read-only role", () => {
    const document = new JSDOM(page(false)).window.document;
    expect(document.body.textContent).toContain(labels.readOnly);
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.body.textContent).toContain("customer@example.test");
    expect(document.body.textContent).toContain("blocked@example.test");
  });
});
