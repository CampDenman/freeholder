// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.06: prompt → agent proposal → approval → safe service calls → visual
// review; separately code proposal → gates → patch (PR delivery needs a
// connected repository and is not faked here).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
});
