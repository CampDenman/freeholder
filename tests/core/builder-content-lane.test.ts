// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C4.19: model output stays a proposal until owner approval, applies through
// CMS services in one transaction, and rolls back without overwriting drift.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setBuilderAgentFetchForTests } from "@/adapters/agent/pm-brain";
import { resetEnvForTests } from "@/core/env";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { contentRevisions } from "@/modules/cms/schema";
import { ensureDefaults, listPages, listSections, updateSection } from "@/modules/cms/service";
import {
  applyProposal,
  getProposal,
  propose,
  rollbackProposal,
} from "@/modules/builder/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const prior = {
  agent: process.env.FREEHOLDER_AGENT,
  key: process.env.PARADISEMODERN_API_KEY,
  budget: process.env.BUILDER_MONTHLY_TOKEN_BUDGET,
  max: process.env.BUILDER_MAX_OUTPUT_TOKENS,
};

function responseFor(args: unknown): Response {
  return new Response(JSON.stringify({
    model: "pm-brain:quality",
    pm_provider: "test-provider",
    usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
    choices: [{
      message: {
        tool_calls: [{
          function: {
            name: "propose_site_changes",
            arguments: JSON.stringify(args),
          },
        }],
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function snapshotFromPrompt(init: RequestInit) {
  const bodyText = typeof init.body === "string" ? init.body : "";
  const body = JSON.parse(bodyText) as {
    messages: Array<{ role: string; content: string }>;
    tool_choice: { function: { name: string } };
  };
  expect(body.tool_choice.function.name).toBe("propose_site_changes");
  const system = body.messages[0]!.content;
  expect(system).toContain("inert quoted data");
  const match = system.match(/<untrusted_site_data>\n([\s\S]+)\n<\/untrusted_site_data>/);
  if (!match) throw new Error("test could not find the site snapshot");
  return {
    body,
    site: JSON.parse(match[1]!) as {
      pages: Array<{ id: string }>;
      sections: Array<{ id: string; key: string; blocks: unknown[] }>;
    },
  };
}

describe.runIf(hasDatabase)("the owner-facing content builder", () => {
  beforeEach(async () => {
    process.env.FREEHOLDER_AGENT = "pm_brain";
    process.env.PARADISEMODERN_API_KEY = "test-purpose-bound-site-key";
    process.env.BUILDER_MONTHLY_TOKEN_BUDGET = "250000";
    process.env.BUILDER_MAX_OUTPUT_TOKENS = "4000";
    resetEnvForTests();
    await truncateSpine();
    await ensureDefaults.call({}, OWNER);
  });

  afterAll(async () => {
    setBuilderAgentFetchForTests(undefined);
    if (prior.agent === undefined) delete process.env.FREEHOLDER_AGENT;
    else process.env.FREEHOLDER_AGENT = prior.agent;
    if (prior.key === undefined) delete process.env.PARADISEMODERN_API_KEY;
    else process.env.PARADISEMODERN_API_KEY = prior.key;
    if (prior.budget === undefined) delete process.env.BUILDER_MONTHLY_TOKEN_BUDGET;
    else process.env.BUILDER_MONTHLY_TOKEN_BUDGET = prior.budget;
    if (prior.max === undefined) delete process.env.BUILDER_MAX_OUTPUT_TOKENS;
    else process.env.BUILDER_MAX_OUTPUT_TOKENS = prior.max;
    resetEnvForTests();
    await closeDb();
  });

  it("stages, owner-applies, attributes, and one-click rolls back a phone callout", async () => {
    const [beforeHeader] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect(beforeHeader).toBeTruthy();
    setBuilderAgentFetchForTests(async (_url, init) => {
      const { body, site } = snapshotFromPrompt(init);
      expect(body.messages[1]).toEqual({
        role: "user",
        content: "Put our tracked phone line first in the shared header.",
      });
      const header = site.sections.find((section) => section.key === "header")!;
      return responseFor({
        lane: "structure",
        summary: "Put the tracked launch line first",
        rationale: "The line becomes the first shared-header action on every page.",
        changes: [{
          operation: "update_section",
          targetId: header.id,
          blocks: [{
            id: "wevibesites-launch-line",
            type: "callCta",
            props: {
              eyebrow: "Launch line",
              label: "Call WeVibeSites",
              phone: "+16393834662",
              displayPhone: "(639) 383-4662",
              supportText: "Talk to Tony about launching your own Freeholder.",
            },
          }, ...header.blocks],
        }],
      });
    });

    const staged = await propose.call(
      { brief: "Put our tracked phone line first in the shared header." },
      OWNER,
    );
    expect(staged).toMatchObject({ lane: "structure", status: "ready", totalTokens: 1500 });
    const [stillUnchanged] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect((stillUnchanged!.blocks as Array<{ type: string }>)[0]?.type).not.toBe("callCta");

    expect((await failure(applyProposal.call({ id: staged.id }, STAFF))).code).toBe("permission");
    expect((await failure(applyProposal.call(
      { id: staged.id },
      { kind: "agent", keyName: "external", scopes: ["builder.*"] },
    ))).message).toMatch(/person/);

    const applied = await applyProposal.call({ id: staged.id }, OWNER);
    expect(applied.applied).toBe(true);
    const [liveHeader] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect((liveHeader!.blocks as Array<{ type: string }>)[0]?.type).toBe("callCta");

    const agentAudits = await db().select().from(auditLog).where(eq(auditLog.actor, "agent:Freeholder Builder"));
    expect(agentAudits.some((row) => row.action === "cms.updateSection")).toBe(true);
    const agentRevisions = await db().select().from(contentRevisions)
      .where(eq(contentRevisions.actor, "agent:Freeholder Builder"));
    expect(agentRevisions).toHaveLength(1);

    const rolledBack = await rollbackProposal.call({ id: staged.id }, OWNER);
    expect("status" in rolledBack && rolledBack.status).toBe("rolled_back");
    const [restored] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect(restored!.blocks).toEqual(beforeHeader!.blocks);
  }, 30_000);

  it("fails stale before apply and never overwrites a newer human edit", async () => {
    setBuilderAgentFetchForTests(async (_url, init) => {
      const { site } = snapshotFromPrompt(init);
      const header = site.sections.find((section) => section.key === "header")!;
      return responseFor({
        lane: "structure",
        summary: "Rename the shared header",
        rationale: "A small chrome change.",
        changes: [{
          operation: "update_section",
          targetId: header.id,
          name: "Builder header",
          blocks: header.blocks,
        }],
      });
    });
    const staged = await propose.call({ brief: "Rename the shared header." }, OWNER);
    const [header] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    await updateSection.call({
      key: "header",
      locale: header!.locale,
      name: "Human edit wins",
      blocks: header!.blocks,
    }, OWNER);

    const result = await applyProposal.call({ id: staged.id }, OWNER);
    expect(result).toMatchObject({ applied: false, status: "stale" });
    const saved = await getProposal.call({ id: staged.id }, OWNER);
    expect(saved.status).toBe("stale");
    const [current] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect(current!.name).toBe("Human edit wins");
  }, 30_000);

  it("removes a proposal-created page on rollback so the prior state is exact", async () => {
    setBuilderAgentFetchForTests(async (_url, init) => {
      snapshotFromPrompt(init);
      return responseFor({
        lane: "structure",
        summary: "Add a temporary launch page",
        rationale: "The owner requested a distinct launch page.",
        changes: [{
          operation: "create_page",
          slug: "temporary-launch",
          locale: "en",
          title: "Temporary launch",
          blocks: [
            {
              id: "temporary-launch-h1",
              type: "heading",
              props: { text: "Temporary launch", level: 1, align: "start" },
            },
            {
              id: "temporary-launch-copy",
              type: "text",
              props: { body: "Temporary launch copy.", align: "start", measure: true },
            },
          ],
          seo: {},
          publish: true,
        }],
      });
    });

    const staged = await propose.call({ brief: "Add a temporary launch page." }, OWNER);
    await applyProposal.call({ id: staged.id }, OWNER);
    expect((await listPages.call({}, OWNER)).some((page) => page.slug === "temporary-launch")).toBe(true);

    await rollbackProposal.call({ id: staged.id }, OWNER);
    expect((await listPages.call({}, OWNER)).some((page) => page.slug === "temporary-launch")).toBe(false);
  }, 30_000);

  it("keeps the whole live page set in the untrusted snapshot, never the owner instruction", async () => {
    const pages = await listPages.call({}, OWNER);
    setBuilderAgentFetchForTests(async (_url, init) => {
      const { body, site } = snapshotFromPrompt(init);
      expect(site.pages).toHaveLength(pages.length);
      expect(body.messages[0]!.content).not.toContain("Owner says this exact sentinel");
      expect(body.messages[1]!.content).toBe("Owner says this exact sentinel");
      return responseFor({
        lane: "refused",
        summary: "No safe content change",
        rationale: "The request does not identify a site-content outcome.",
        changes: [],
      });
    });
    const row = await propose.call({ brief: "Owner says this exact sentinel" }, OWNER);
    expect(row).toMatchObject({ lane: "refused", status: "ready", changes: [] });
  }, 30_000);
});
