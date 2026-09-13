// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.06: prompt → agent proposal → approval → safe service calls → visual
// review/publish; separately code proposal → gates → patch. GitHub PR delivery
// needs a connected repository and is remaining honesty, not a claimed hop.
// Content-lane rollback is walked via builder.propose / rollbackProposal.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setBuilderAgentFetchForTests } from "@/adapters/agent/pm-brain";
import { resetEnvForTests } from "@/core/env";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { createContact, getContact } from "@/core/contacts/service";
import {
  connectAgentRuntime,
  createTask,
  getTask,
  hireAgent,
  inspectRun,
} from "@/core/agents/service";
import { claimTask } from "@/core/agents/execution";
import { approveWrite, proposeWrite } from "@/core/agents/writes";
import { describeProposal, runCodeGates } from "@/modules/builder/code-gates";
import { toPatch } from "@/modules/builder/code-delivery";
import { applyProposal, propose, rollbackProposal } from "@/modules/builder/service";
import { ensureDefaults, listSections } from "@/modules/cms/service";
import type { Actor } from "@/core/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function asAgent(name: string, scopes: string[] = ["contacts.update"]): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes };
}

const HEADER = `// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
`;

function goodPlugin(name = "tide-times") {
  return [
    {
      path: `plugins/${name}/manifest.ts`,
      contents: `${HEADER}import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  kind: "plugin",
  name: "${name}",
  version: "0.1.0",
  freeholder: "^1.0.0",
  license: "Apache-2.0",
  permissions: ["cms:view"],
  migrations: [],
  capabilities: { blocks: true },
});
`,
    },
    {
      path: `plugins/${name}/block.tsx`,
      contents: `${HEADER}export function TideTimes() {
  return null;
}
`,
    },
  ];
}

describe.runIf(hasDatabase)("C11.06 agent proposal and code gates", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });
  afterEach(() => {
    setBuilderAgentFetchForTests(undefined);
  });
  afterAll(closeDb);

  it("proposes a write, executes it once on approval, and gates a code patch", async () => {
    const link = await connectAgentRuntime.call(
      { name: "runtime-C11", kind: "inbound" },
      OWNER,
    );
    await hireAgent.call(
      {
        connectionId: link.id,
        name: "C11Writer",
        role: "writer",
        toolScopes: ["contacts.update"],
        autonomy: "approve",
      },
      OWNER,
    );
    const person = await createContact.call({ name: "Rae", email: "rae-c11-agent@example.test" }, OWNER);
    const task = await createTask.call({ title: "Rename Rae" }, OWNER);
    const claim = await claimTask.call({}, asAgent("C11Writer"));
    const proposed = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.update",
        input: { id: person.id, name: "Rae Lane" },
      },
      asAgent("C11Writer"),
    );
    expect(proposed.approval).toBeTruthy();
    expect((await getTask.call({ id: task.id }, OWNER))?.status).toBe("waiting_approval");

    await approveWrite.call({ id: proposed.approval!.id }, OWNER);
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae Lane");
    const inspected = await inspectRun.call({ runId: claim!.runId }, OWNER);
    expect(inspected).toBeTruthy();
    expect((await getTask.call({ id: task.id }, OWNER))?.status).toBe("queued");

    const files = goodPlugin();
    const report = runCodeGates(files, "tide-times");
    expect(report.passed).toBe(true);
    const patch = toPatch(files);
    expect(patch).toContain("plugins/tide-times/manifest.ts");
    expect(describeProposal(files, "tide-times")).toBeTruthy();

    const stray = runCodeGates(
      [...files, { path: "src/core/service.ts", contents: `${HEADER}export const x = 1;\n` }],
      "tide-times",
    );
    expect(stray.passed).toBe(false);
  });

  it("prompts the builder, applies a visual review, and rolls the section back", async () => {
    process.env.FREEHOLDER_AGENT = "pm_brain";
    process.env.PARADISEMODERN_API_KEY = "test-purpose-bound-site-key";
    process.env.BUILDER_MONTHLY_TOKEN_BUDGET = "250000";
    process.env.BUILDER_MAX_OUTPUT_TOKENS = "4000";
    resetEnvForTests();
    await ensureDefaults.call({}, OWNER);
    const [beforeHeader] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect(beforeHeader).toBeTruthy();
    setBuilderAgentFetchForTests(async (_url, init) => {
      const bodyText = typeof init.body === "string" ? init.body : "";
      const body = JSON.parse(bodyText) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[1]?.content).toBe("Put a launch line in the shared header.");
      const siteMatch = body.messages[0]!.content.match(
        /<untrusted_site_data>\n([\s\S]+)\n<\/untrusted_site_data>/,
      );
      const site = JSON.parse(siteMatch![1]!) as {
        sections: Array<{ id: string; key: string; blocks: unknown[] }>;
      };
      const header = site.sections.find((section) => section.key === "header")!;
      return new Response(
        JSON.stringify({
          model: "pm-brain:quality",
          pm_provider: "test-provider",
          usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "propose_site_changes",
                      arguments: JSON.stringify({
                        lane: "structure",
                        summary: "Put the launch line first",
                        rationale: "A visual review of the shared header.",
                        changes: [
                          {
                            operation: "update_section",
                            targetId: header.id,
                            blocks: [
                              {
                                id: "c11-launch-line",
                                type: "callCta",
                                props: {
                                  eyebrow: "Launch line",
                                  label: "Call the studio",
                                  phone: "+16393834662",
                                  displayPhone: "(639) 383-4662",
                                  supportText: "Talk about the sitting.",
                                },
                              },
                              ...header.blocks,
                            ],
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const staged = await propose.call({ brief: "Put a launch line in the shared header." }, OWNER);
    expect(staged.status).toBe("ready");
    const applied = await applyProposal.call({ id: staged.id }, OWNER);
    expect(applied.applied).toBe(true);
    const [liveHeader] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect((liveHeader!.blocks as Array<{ type: string }>)[0]?.type).toBe("callCta");
    const rolledBack = await rollbackProposal.call({ id: staged.id }, OWNER);
    expect("status" in rolledBack && rolledBack.status).toBe("rolled_back");
    const [restored] = (await listSections.call({}, OWNER)).filter((section) => section.key === "header");
    expect(restored!.blocks).toEqual(beforeHeader!.blocks);
  });
});
