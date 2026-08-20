// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Money, capped before it is spent (C4.06, MASTER.md §40).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { agentRuns, agentSpend } from "@/core/agents/schema";
import {
  agentSpendReport,
  connectAgentRuntime,
  createTask,
  getTask,
  hireAgent,
} from "@/core/agents/service";
import { runManagedAgentWork } from "@/core/agents/managed";
import { listNotifications } from "@/core/notifications/service";
import {
  crossedAlertThreshold,
  periodSpend,
  resolveRunBudget,
} from "@/core/agents/budget";
import {
  estimateNextTurnCents,
  KNOWN_MODEL_PRICES,
  modelPrice,
  turnCostCents,
} from "@/core/agents/pricing";
import { setWorkforceOpenAiFetchForTests } from "@/adapters/agent/workforce-openai";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const KEY_VAR = "TEST_BUDGET_LOOP_KEY";

/** A model that always answers with plain text, at a known token cost. */
function scriptModel(usage = { prompt_tokens: 1_000_000, completion_tokens: 0 }) {
  setWorkforceOpenAiFetchForTests(async () =>
    new Response(
      JSON.stringify({
        model: "gpt-test",
        choices: [{ finish_reason: "stop", message: { content: "Done." } }],
        usage,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

async function hireManaged(
  name: string,
  budgetCents: number,
  price: { inputCentsPerMillion?: number; outputCentsPerMillion?: number } = {
    inputCentsPerMillion: 100,
    outputCentsPerMillion: 500,
  },
) {
  const connection = await connectAgentRuntime.call(
    {
      name: `runtime-${name}`,
      kind: "managed",
      adapter: "openai",
      model: "gpt-test",
      credentialRef: KEY_VAR,
      ...price,
    },
    OWNER,
  );
  return hireAgent.call(
    {
      connectionId: connection.id,
      name,
      role: "worker",
      toolScopes: ["contacts.list"],
      autonomy: "autonomous",
      budgetCents,
      budgetPeriod: "month",
    },
    OWNER,
  );
}

describe("model pricing", () => {
  it("prices a turn in whole cents with one rounding at the end", () => {
    const price = { inputCentsPerMillion: 500, outputCentsPerMillion: 2_500 };
    // 1M in at 500 + 1M out at 2500 = 3000 cents exactly.
    expect(turnCostCents(price, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      3_000,
    );
    // Half a cent each way rounds once on the total, not twice.
    expect(turnCostCents(price, { inputTokens: 1_000, outputTokens: 100 })).toBe(1);
    expect(turnCostCents(price, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("knows published prices and refuses to guess at anything else", () => {
    expect(modelPrice("claude-opus-5")).toEqual(KNOWN_MODEL_PRICES["claude-opus-5"]);
    expect(modelPrice("some-model-nobody-published")).toBeNull();
    expect(modelPrice(null)).toBeNull();
    // An owner's own price always wins: they know their contract.
    expect(
      modelPrice("claude-opus-5", { inputCentsPerMillion: 1, outputCentsPerMillion: 2 }),
    ).toEqual({ inputCentsPerMillion: 1, outputCentsPerMillion: 2 });
  });

  it("estimates the next turn high rather than low", () => {
    const price = { inputCentsPerMillion: 1_000, outputCentsPerMillion: 1_000 };
    const estimate = estimateNextTurnCents(price, {
      largestInputTokens: 500_000,
      maxOutputTokens: 4_000,
    });
    // A budget that under-estimates would let a run cross the cap it guards,
    // so the estimate assumes the whole output ceiling is used.
    expect(estimate).toBeGreaterThanOrEqual(
      turnCostCents(price, { inputTokens: 500_000, outputTokens: 4_000 }),
    );
  });

  it("names the threshold an owner should hear about, once", () => {
    expect(crossedAlertThreshold(0, 810, 1_000)).toBe("warning");
    expect(crossedAlertThreshold(810, 900, 1_000)).toBeNull();
    expect(crossedAlertThreshold(900, 1_000, 1_000)).toBe("exhausted");
    expect(crossedAlertThreshold(1_000, 1_200, 1_000)).toBeNull();
    expect(crossedAlertThreshold(0, 50, 0)).toBeNull();
  });
});

describe.runIf(hasDatabase)("budgets in the managed loop", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    process.env[KEY_VAR] = "test-key";
  });
  afterEach(() => {
    setWorkforceOpenAiFetchForTests(undefined);
    delete process.env[KEY_VAR];
  });
  afterAll(closeDb);

  it("prices a real run into the ledger", async () => {
    const agent = await hireManaged("Priced", 10_000);
    const task = await createTask.call({ title: "Say hello" }, OWNER);
    // 1M input tokens at 100 cents per million = 100 cents.
    scriptModel({ prompt_tokens: 1_000_000, completion_tokens: 0 });

    await runManagedAgentWork();
    expect((await getTask.call({ id: task.id }, OWNER))?.status).toBe("done");
    const [run] = await db().select().from(agentRuns).where(eq(agentRuns.taskId, task.id));
    expect(run?.costCents).toBe(100);
    const [ledger] = await db().select().from(agentSpend).where(eq(agentSpend.agentId, agent.id));
    expect(ledger?.costCents).toBe(100);
    expect(await periodSpend(agent.id, "month")).toBe(100);

    const [report] = await agentSpendReport.call({}, OWNER);
    expect(report).toMatchObject({
      name: "Priced",
      spentCents: 100,
      remainingCents: 9_900,
      runs: 1,
      priced: true,
    });
  });

  it("stops before a turn it cannot afford", async () => {
    // 20 cents of budget against a turn estimated far above it.
    await hireManaged("Frugal", 20, {
      inputCentsPerMillion: 100_000,
      outputCentsPerMillion: 100_000,
    });
    const task = await createTask.call({ title: "Too expensive" }, OWNER);
    scriptModel();

    await runManagedAgentWork();
    const [run] = await db().select().from(agentRuns).where(eq(agentRuns.taskId, task.id));
    expect(run?.stopReason).toBe("budget");
    expect(run?.costCents).toBe(0);
    // Refused before the provider was called at all: no tokens, no charge.
    expect(run?.tokensIn).toBe(0);
    const after = await getTask.call({ id: task.id }, OWNER);
    expect(after?.failureReason).toContain("budget");
  });

  it("will not claim at all without a budget, and says why", async () => {
    await hireManaged("Broke", 0);
    await createTask.call({ title: "Unfundable" }, OWNER);
    scriptModel();

    const tick = await runManagedAgentWork();
    expect(tick).toEqual({ runs: 0, blocked: 1 });
    // No attempts burned on a setting the owner can fix.
    const [task] = await db().select().from(agentRuns);
    expect(task).toBeUndefined();
    const inbox = await listNotifications.call({}, OWNER);
    expect(inbox.some((item) => item.body.includes("no budget"))).toBe(true);
  });

  it("will not run an unpriced model", async () => {
    await hireManaged("Unpriced", 5_000, {});
    await createTask.call({ title: "Unpriceable" }, OWNER);
    scriptModel();

    const tick = await runManagedAgentWork();
    expect(tick.blocked).toBe(1);
    const inbox = await listNotifications.call({}, OWNER);
    expect(inbox.some((item) => item.body.includes("does not know what"))).toBe(true);
    const [report] = await agentSpendReport.call({}, OWNER);
    expect(report?.priced).toBe(false);
  });

  it("tells the owner when an agent crosses its budget", async () => {
    // One 100-cent run against a 100-cent cap: crosses straight to exhausted.
    const agent = await hireManaged("Spender", 100);
    await createTask.call({ title: "Spend it all" }, OWNER);
    scriptModel({ prompt_tokens: 1_000_000, completion_tokens: 0 });

    await runManagedAgentWork();
    expect(await periodSpend(agent.id, "month")).toBe(100);
    const inbox = await listNotifications.call({}, OWNER);
    const alert = inbox.find((item) => item.topic === "agents.budget");
    expect(alert?.priority).toBe("critical");
    expect(alert?.href).toBe("/admin/work/spend");

    // And the next tick refuses to claim, because the period is spent.
    await createTask.call({ title: "One more" }, OWNER);
    const tick = await runManagedAgentWork();
    expect(tick).toEqual({ runs: 0, blocked: 1 });
  });

  it("honours a task's own budget under the agent's", async () => {
    const agent = await hireManaged("Careful", 10_000);
    const task = await createTask.call(
      { title: "Cheap work only", budgetCents: 5 },
      OWNER,
    );
    // The model keeps asking for another tool call, so only the task's own
    // ceiling can end this. A first turn whose real input dwarfs the
    // estimator's floor is the one documented exposure: it overshoots by
    // that single turn, is recorded in full, and the next turn is refused
    // before the provider is called again.
    setWorkforceOpenAiFetchForTests(async () =>
      new Response(
        JSON.stringify({
          model: "gpt-test",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  { id: "call_1", function: { name: "contacts_list", arguments: "{}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runManagedAgentWork();
    const [run] = await db().select().from(agentRuns).where(eq(agentRuns.taskId, task.id));
    expect(run?.stopReason).toBe("budget");
    // Exactly one turn's worth: the second was refused before it was sent.
    expect(run?.costCents).toBe(100);
    expect(run?.tokensIn).toBe(1_000_000);
    expect(await periodSpend(agent.id, "month")).toBe(100);
    // The agent's own 10,000-cent period budget is nowhere near spent — it
    // was the task's 5-cent ceiling that bound this work.
    const [report] = await agentSpendReport.call({}, OWNER);
    expect(report?.remainingCents).toBe(9_900);
    expect((await getTask.call({ id: task.id }, OWNER))?.failureReason).toContain("budget");
  });

  it("asks for only as many output tokens as the budget can pay for", async () => {
    // 1 cent left against 500 cents per million output tokens buys 2,000
    // tokens — the turn must ask for that, not the 4,000-token ceiling.
    await hireManaged("Clamped", 1);
    await createTask.call({ title: "Small change" }, OWNER);
    let asked = 0;
    setWorkforceOpenAiFetchForTests(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { max_completion_tokens: number };
      asked = body.max_completion_tokens;
      return new Response(
        JSON.stringify({
          model: "gpt-test",
          choices: [{ finish_reason: "stop", message: { content: "Done." } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await runManagedAgentWork();
    expect(asked).toBe(2_000);
  });

  it("refuses a connection priced on one side only", async () => {
    const refused = await failure(
      connectAgentRuntime.call(
        {
          name: "Half priced",
          kind: "managed",
          adapter: "openai",
          model: "gpt-test",
          inputCentsPerMillion: 100,
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
  });

  it("resolves nested scopes with the tightest cap winning", async () => {
    const agent = await hireManaged("Nested", 1_000);
    const task = await createTask.call({ title: "Bounded", budgetCents: 250 }, OWNER);
    const resolved = await resolveRunBudget({
      agentId: agent.id,
      budgetCents: 1_000,
      budgetPeriod: "month",
      taskId: task.id,
      taskBudgetCents: 250,
      model: "gpt-test",
      priceOverride: { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
    });
    expect("budget" in resolved && resolved.budget.remainingCents).toBe(250);
    expect("budget" in resolved && resolved.budget.period.remainingCents).toBe(1_000);
  });
});
