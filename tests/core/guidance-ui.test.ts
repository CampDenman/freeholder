// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Static accessibility, progress semantics and forbidden-control absence for
// the shared staff/customer onboarding surface.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { translator } from "@/core/i18n";
import type { GuidanceFlowView } from "@/core/guidance/service";
import { GuidancePanel } from "@/ui/GuidancePanel";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";

const editorFlow: GuidanceFlowView = {
  key: "core.editor-first-win",
  version: 1,
  titleKey: "guidance.flow.editor.title",
  descriptionKey: "guidance.flow.editor.description",
  audienceRoles: ["editor"],
  requiredCapabilities: ["cms:manage"],
  audienceMatch: true,
  state: "active",
  completedCount: 0,
  totalCount: 1,
  startedAt: new Date("2026-08-13T16:00:00.000Z"),
  completedAt: null,
  steps: [
    {
      key: "publish-page",
      titleKey: "guidance.step.publishPage.title",
      descriptionKey: "guidance.step.publishPage.description",
      href: "/admin/pages",
      requiredCapabilities: ["cms:manage"],
      outcome: { type: "audit", actions: ["cms.publishPage"] },
      completed: false,
    },
  ],
};

async function action(_form: FormData): Promise<void> {}

function page(flow: GuidanceFlowView = editorFlow): string {
  const content = renderToStaticMarkup(
    createElement(GuidancePanel, {
      flows: [flow],
      action,
      returnTo: "/admin#guidance",
      t: translator("en"),
    }),
  );
  return `<!doctype html><html lang="en"><head><title>Guidance</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Overview</h1>${content}</main></body></html>`;
}

describe("guidance panel markup", () => {
  it("passes the static accessibility gate", async () => {
    const result = await auditHtml(page(), "https://example.test/admin");
    expect(result.violations).toEqual([]);
  });

  it("uses native progress, ordered tasks and keyboard-native actions", () => {
    const document = new JSDOM(page()).window.document;
    const progress = document.querySelector("progress");
    expect(progress?.getAttribute("max")).toBe("1");
    expect(progress?.getAttribute("value")).toBe("0");
    expect(progress?.getAttribute("aria-label")).toBe("0 of 1 tasks complete");
    expect(document.querySelectorAll("ol > li")).toHaveLength(1);
    expect(document.querySelectorAll('li[aria-current="step"]')).toHaveLength(1);
    expect(document.querySelectorAll("form")).toHaveLength(2);
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(2);
    expect(document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveLength(0);
  });

  it("contains only the capability-filtered target it was given", () => {
    const document = new JSDOM(page()).window.document;
    expect(document.querySelector('a[href="/admin/pages"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/media"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/forms"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/invitations"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Add reusable media");
  });

  it("does not expose task links until a skipped guide is resumed", () => {
    const skipped: GuidanceFlowView = {
      ...editorFlow,
      state: "dismissed",
    };
    const document = new JSDOM(page(skipped)).window.document;
    expect(document.querySelectorAll("ol a")).toHaveLength(0);
    expect(document.body.textContent).toContain("Resume guide");
    expect(document.body.textContent).toContain("Reset guide");
  });
});
