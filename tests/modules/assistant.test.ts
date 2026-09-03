// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The optional front-site assistant (MASTER.md §31, C9.21).
//
// Three groups. The first is the allow/refuse decision, which is pure and
// needs no database: whether the assistant may answer is the thing an owner
// will dispute when their budget is gone, so every branch is a unit test
// rather than a query somebody has to reason about.
//
// The second is the whole path against a real chat session with the provider
// replaced by a stub — off, unconfigured, over budget, rate limited, and the
// two ways a scope can refuse. The stub is a global `fetch`, so the adapter
// under test is the adapter that ships.
//
// The third is the settings surface, which exists to prove one thing above all
// others: the key never comes back out.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { getSiteChat, postSiteChat, startSiteChat } from "@/core/messaging/chat";
import { extractJson } from "@/adapters/ai/anthropic";
import { allowance, refusalOutcome } from "@/modules/assistant/limits";
import { assistantTurns } from "@/modules/assistant/schema";
import type { AssistantSettings } from "@/modules/assistant/schema";
import {
  answer,
  scopes,
  setScope,
  settings,
  turns,
  updateSettings,
} from "@/modules/assistant/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Harbour Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const KEY_VARIABLE = "TEST_ASSISTANT_KEY";

/**
 * A price that makes a token cost a whole cent.
 *
 * The published prices are cents per *million* tokens, so a realistic model
 * costs a fraction of a cent per chat turn and a budget test written against
 * one would assert that nothing rounds to nothing. This is the arithmetic
 * under test, not the tariff.
 */
const ONE_CENT_PER_TOKEN = 1_000_000;

const BASE_SETTINGS: AssistantSettings = {
  id: 1,
  enabled: true,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  baseUrl: null,
  credentialRef: KEY_VARIABLE,
  inputCentsPerMillion: null,
  outputCentsPerMillion: null,
  maxOutputTokens: 300,
  displayName: null,
  spendCapCents: 500,
  spendPeriod: "month",
  repliesPerConversation: 20,
  repliesPerHour: 60,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PRICE = { inputCentsPerMillion: 100, outputCentsPerMillion: 500 };

describe("the allowance decision", () => {
  const base = {
    settings: BASE_SETTINGS,
    spentCents: 0,
    repliesThisHour: 0,
    repliesHere: 0,
    price: PRICE,
    estimateCents: 1,
  };

  it("allows an answer inside every limit", () => {
    const verdict = allowance(base);
    expect(verdict.allowed).toBe(true);
  });

  it("refuses when the period budget is gone", () => {
    const verdict = allowance({ ...base, spentCents: 500 });
    expect(verdict).toMatchObject({ allowed: false, refusal: { kind: "period_exhausted" } });
  });

  it("refuses before the answer that would cross the cap, not after", () => {
    // 480 spent of 500 leaves 20, and this answer might cost 40. A platform
    // that tallied afterwards would spend the 40 and report the overspend.
    const verdict = allowance({ ...base, spentCents: 480, estimateCents: 40 });
    expect(verdict).toMatchObject({ allowed: false, refusal: { kind: "would_exceed" } });
  });

  it("refuses an unpriced model rather than guessing what it costs", () => {
    const verdict = allowance({ ...base, price: null });
    expect(verdict).toMatchObject({ allowed: false, refusal: { kind: "unpriced" } });
  });

  it("refuses when there is no budget at all", () => {
    const verdict = allowance({
      ...base,
      settings: { ...BASE_SETTINGS, spendCapCents: 0 },
    });
    expect(verdict).toMatchObject({ allowed: false, refusal: { kind: "no_budget" } });
  });

  it("reads a limit of zero as never, never as unlimited", () => {
    const conversation = allowance({
      ...base,
      settings: { ...BASE_SETTINGS, repliesPerConversation: 0 },
    });
    expect(conversation).toMatchObject({
      allowed: false,
      refusal: { kind: "conversation_cap", limit: 0 },
    });
    const hourly = allowance({
      ...base,
      settings: { ...BASE_SETTINGS, repliesPerHour: 0 },
    });
    expect(hourly).toMatchObject({ allowed: false, refusal: { kind: "hourly_cap", limit: 0 } });
  });

  it("stops one conversation before it stops the whole site", () => {
    const verdict = allowance({ ...base, repliesHere: 20, repliesThisHour: 60 });
    expect(verdict).toMatchObject({ refusal: { kind: "conversation_cap" } });
    expect(refusalOutcome({ kind: "conversation_cap", limit: 20 })).toBe(
      "refused_conversation_cap",
    );
  });
});

describe("reading a model's answer", () => {
  it("finds the object even when the model wrapped it in a sentence", () => {
    expect(
      extractJson('Sure! {"reply": "Hello", "action": null} — hope that helps'),
    ).toEqual({ reply: "Hello", action: null });
  });

  it("survives a brace inside a string", () => {
    expect(extractJson('{"reply": "use {curly} braces"}')).toEqual({
      reply: "use {curly} braces",
    });
  });

  it("returns nothing for prose", () => {
    expect(extractJson("I am afraid I cannot do that.")).toBeUndefined();
  });
});

interface StubReply {
  reply: string;
  action?: { id: string; arguments?: unknown } | null;
}

describe.runIf(hasDatabase)("the front-site assistant", () => {
  let calls = 0;

  beforeAll(async () => {
    // Boot wires every module, and it grows with each one.
    await ready();
  }, 180_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
    process.env[KEY_VARIABLE] = "not-a-real-key";
    calls = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    delete process.env[KEY_VARIABLE];
    await closeDb();
  });

  /** The provider, replaced at the one place the adapter actually reaches it. */
  function stubModel(
    reply: StubReply,
    usage = { input_tokens: 1_000, output_tokens: 100 },
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: "claude-haiku-4-5",
              content: [{ type: "text", text: JSON.stringify(reply) }],
              usage,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
  }

  function stubFailure(status = 500): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(new Response("nope", { status }));
      }),
    );
  }

  async function configure(overrides: Record<string, unknown> = {}) {
    return updateSettings.call(
      {
        enabled: true,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        credentialRef: KEY_VARIABLE,
        maxOutputTokens: 300,
        spendCapCents: 5_000,
        spendPeriod: "month",
        repliesPerConversation: 20,
        repliesPerHour: 60,
        ...overrides,
      },
      OWNER,
    );
  }

  async function startChat(email: string, message = "Do you photograph weddings?") {
    return startSiteChat.call(
      { name: "Sam Visitor", email, message, locale: "en" },
      ANONYMOUS,
    );
  }

  async function recordedTurns() {
    return db()
      .select()
      .from(assistantTurns)
      .orderBy(desc(assistantTurns.createdAt));
  }

  it("is off until somebody switches it on, and off means nothing happens", async () => {
    stubModel({ reply: "Hello!" });
    const chat = await startChat("off@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);

    expect(result.status).toBe("off");
    expect(calls).toBe(0);
    expect(await recordedTurns()).toHaveLength(0);

    // And the site chat is exactly what it was before this module existed.
    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0]!.channel).toBe("chat");
  });

  it("switching it off again stops it answering, without losing the setup", async () => {
    await configure();
    stubModel({ reply: "We do." });
    const first = await startChat("toggle@example.com");
    expect((await answer.call({ token: first.token }, ANONYMOUS)).status).toBe("answered");

    await configure({ enabled: false });
    const second = await startChat("toggle2@example.com");
    expect((await answer.call({ token: second.token }, ANONYMOUS)).status).toBe("off");

    const saved = await settings.call({}, OWNER);
    expect(saved.enabled).toBe(false);
    expect(saved.model).toBe("claude-haiku-4-5");
    expect(saved.credentialRef).toBe(KEY_VARIABLE);
  });

  it("answers on the contact's own conversation, and charges what it cost", async () => {
    await configure({
      inputCentsPerMillion: ONE_CENT_PER_TOKEN,
      outputCentsPerMillion: ONE_CENT_PER_TOKEN,
    });
    stubModel({ reply: "Yes, we photograph weddings all year." });
    const chat = await startChat("answered@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);
    expect(result.status).toBe("answered");

    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[1]).toMatchObject({
      direction: "outbound",
      channel: "assistant",
      body: "Yes, we photograph weddings all year.",
    });

    const [turn] = await recordedTurns();
    expect(turn).toMatchObject({
      outcome: "answered",
      model: "claude-haiku-4-5",
      inputTokens: 1_000,
      outputTokens: 100,
      // 1,100 tokens at a cent each.
      costCents: 1_100,
    });
    expect((await settings.call({}, OWNER)).spentCents).toBe(1_100);
  });

  it("refuses before it spends when the limit is already reached", async () => {
    await configure({
      spendCapCents: 1,
      inputCentsPerMillion: ONE_CENT_PER_TOKEN,
      outputCentsPerMillion: ONE_CENT_PER_TOKEN,
    });
    stubModel({ reply: "This should never be said." });
    const chat = await startChat("broke@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);

    expect(result.status).toBe("refused");
    // The whole point of checking before rather than tallying after: the
    // provider is never reached, so the refusal costs nothing.
    expect(calls).toBe(0);

    const [turn] = await recordedTurns();
    expect(turn!.outcome).toBe("refused_spend");
    expect(turn!.costCents).toBe(0);
    expect(turn!.detail).toContain("budget");

    // A refusal is returned, not thrown — so the row survives to explain
    // itself, and the visitor's own message is untouched.
    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages).toHaveLength(1);
  });

  it("stops once the period's spending is used up", async () => {
    await configure({
      spendCapCents: 5_000,
      inputCentsPerMillion: ONE_CENT_PER_TOKEN,
      outputCentsPerMillion: ONE_CENT_PER_TOKEN,
    });
    stubModel({ reply: "Happy to help." });
    const chat = await startChat("exhaust@example.com");
    expect((await answer.call({ token: chat.token }, ANONYMOUS)).status).toBe("answered");

    // The owner tightens the cap below what has already been spent.
    await configure({
      spendCapCents: 1,
      inputCentsPerMillion: ONE_CENT_PER_TOKEN,
      outputCentsPerMillion: ONE_CENT_PER_TOKEN,
    });
    await postSiteChat.call({ token: chat.token, message: "And in December?" }, ANONYMOUS);

    const second = await answer.call({ token: chat.token }, ANONYMOUS);
    expect(second.status).toBe("refused");

    const rows = await recordedTurns();
    expect(rows.map((row) => row.outcome)).toEqual(["refused_spend", "answered"]);
    const spend = await settings.call({}, OWNER);
    expect(spend.spentCents).toBe(1_100);
    expect(spend.remainingCents).toBe(0);
  });

  it("stops one conversation running away with the budget", async () => {
    await configure({ repliesPerConversation: 1 });
    stubModel({ reply: "Certainly." });
    const chat = await startChat("cap@example.com");
    expect((await answer.call({ token: chat.token }, ANONYMOUS)).status).toBe("answered");

    await postSiteChat.call({ token: chat.token, message: "And again?" }, ANONYMOUS);
    const second = await answer.call({ token: chat.token }, ANONYMOUS);

    expect(second.status).toBe("refused");
    const [turn] = await recordedTurns();
    expect(turn!.outcome).toBe("refused_conversation_cap");
  });

  it("takes an action the owner granted", async () => {
    await configure();
    await setScope.call({ action: "hand_to_a_person", enabled: true }, OWNER);
    stubModel({
      reply: "Let me get somebody who knows.",
      action: { id: "hand_to_a_person", arguments: { reason: "Asked about December" } },
    });
    const chat = await startChat("granted@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);
    expect(result).toMatchObject({ status: "answered", action: "hand_to_a_person" });

    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.escalated).toBe(true);

    const [turn] = await recordedTurns();
    expect(turn).toMatchObject({
      outcome: "answered",
      action: "hand_to_a_person",
      actionAllowed: true,
    });
  });

  it("refuses an action the owner has not granted, and says so", async () => {
    await configure();
    stubModel({
      reply: "Let me get somebody who knows.",
      action: { id: "hand_to_a_person", arguments: { reason: "Asked about December" } },
    });
    const chat = await startChat("ungranted@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);
    expect(result.status).toBe("answered");

    // The words went out; the act did not.
    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.escalated).toBe(false);

    const [turn] = await recordedTurns();
    expect(turn).toMatchObject({
      outcome: "refused_scope",
      action: "hand_to_a_person",
      actionAllowed: false,
    });
    expect(turn!.detail).toContain("not switched on");
  });

  it("refuses an action that is not in the catalogue at all", async () => {
    await configure();
    await setScope.call({ action: "hand_to_a_person", enabled: true }, OWNER);
    stubModel({
      reply: "Done!",
      action: { id: "refund_every_invoice", arguments: { all: true } },
    });
    const chat = await startChat("outofbounds@example.com");

    await answer.call({ token: chat.token }, ANONYMOUS);

    const [turn] = await recordedTurns();
    expect(turn).toMatchObject({
      outcome: "refused_scope",
      action: "refund_every_invoice",
      actionAllowed: false,
    });
    expect(turn!.detail).toContain("can ever do");
  });

  it("refuses arguments a granted action does not accept", async () => {
    await configure();
    await setScope.call({ action: "hand_to_a_person", enabled: true }, OWNER);
    // No reason at all: the catalogue entry requires one.
    stubModel({ reply: "One moment.", action: { id: "hand_to_a_person", arguments: {} } });
    const chat = await startChat("badargs@example.com");

    await answer.call({ token: chat.token }, ANONYMOUS);

    const [turn] = await recordedTurns();
    expect(turn!.outcome).toBe("refused_scope");
    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.escalated).toBe(false);
  });

  it("cannot be granted a scope the platform does not offer", async () => {
    const error = await failure(
      setScope.call({ action: "wire_the_bank_account", enabled: true }, OWNER),
    );
    expect(error.code).toBe("not_found");
    const listed = await scopes.call({}, OWNER);
    expect(listed.map((entry) => entry.action).sort()).toEqual([
      "hand_to_a_person",
      "request_quote",
    ]);
    expect(listed.every((entry) => entry.enabled === false)).toBe(true);
  });

  it("attempts one visitor message once, so clicking again costs nothing", async () => {
    // Refused for a reason that leaves the visitor's message the newest one,
    // which is exactly the state a retrying browser lands in.
    await configure({ repliesPerConversation: 0 });
    stubModel({ reply: "Never said." });
    const chat = await startChat("once@example.com");

    expect((await answer.call({ token: chat.token }, ANONYMOUS)).status).toBe("refused");
    expect((await answer.call({ token: chat.token }, ANONYMOUS)).status).toBe(
      "already_attempted",
    );
    expect(calls).toBe(0);
    expect(await recordedTurns()).toHaveLength(1);
  });

  it("records that it is switched on but not set up, rather than failing quietly", async () => {
    await configure({ credentialRef: "TEST_ASSISTANT_MISSING" });
    stubModel({ reply: "unreachable" });
    const chat = await startChat("unconfigured@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);

    expect(result.status).toBe("unconfigured");
    expect(calls).toBe(0);
    const [turn] = await recordedTurns();
    expect(turn!.outcome).toBe("unconfigured");
    expect((await settings.call({}, OWNER)).lastError).toContain("TEST_ASSISTANT_MISSING");
  });

  it("keeps a provider failure inside the module", async () => {
    await configure();
    stubFailure(503);
    const chat = await startChat("broken@example.com");

    const result = await answer.call({ token: chat.token }, ANONYMOUS);

    expect(result.status).toBe("failed");
    const [turn] = await recordedTurns();
    expect(turn!.outcome).toBe("failed");
    // Whatever the provider said about the request stays with the provider.
    expect(turn!.detail).toBe("The model returned HTTP 503.");

    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages).toHaveLength(1);
  });

  function stubRawText(text: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: "claude-haiku-4-5",
              content: [{ type: "text", text }],
              usage: { input_tokens: 1_000, output_tokens: 100 },
            }),
            { status: 200 },
          ),
        );
      }),
    );
  }

  it("still delivers a model that answered in prose instead of JSON", async () => {
    await configure({
      inputCentsPerMillion: ONE_CENT_PER_TOKEN,
      outputCentsPerMillion: ONE_CENT_PER_TOKEN,
    });
    stubRawText("We photograph weddings every month of the year.");
    const chat = await startChat("prose@example.com");

    expect((await answer.call({ token: chat.token }, ANONYMOUS)).status).toBe("answered");
    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages[1]!.body).toBe(
      "We photograph weddings every month of the year.",
    );
    // A reply with no action can carry no action, whatever the words claim.
    const [turn] = await recordedTurns();
    expect(turn!.action).toBeNull();
    expect(turn!.costCents).toBe(1_100);
  });

  it("pays for an empty answer and records that it was unusable", async () => {
    await configure({
      inputCentsPerMillion: ONE_CENT_PER_TOKEN,
      outputCentsPerMillion: ONE_CENT_PER_TOKEN,
    });
    stubRawText("   ");
    const chat = await startChat("garbage@example.com");

    expect((await answer.call({ token: chat.token }, ANONYMOUS)).status).toBe("failed");
    const [turn] = await recordedTurns();
    expect(turn!.outcome).toBe("failed");
    // The money left the account even though nothing usable came back. A
    // budget that only counts the answers an owner liked is not a budget.
    expect(turn!.costCents).toBe(1_100);
    const transcript = await getSiteChat.call({ token: chat.token }, ANONYMOUS);
    expect(transcript.messages).toHaveLength(1);
  });

  it("has nothing to answer when the last word was its own", async () => {
    await configure();
    stubModel({ reply: "First." });
    const chat = await startChat("quiet@example.com");
    await answer.call({ token: chat.token }, ANONYMOUS);

    // The visitor has said nothing since.
    const again = await answer.call({ token: chat.token }, ANONYMOUS);
    expect(again.status).toBe("nothing_to_answer");
  });

  it("never hands the key back, only whether it is there", async () => {
    await configure();
    const shown = await settings.call({}, OWNER);

    expect(shown.credentialRef).toBe(KEY_VARIABLE);
    expect(shown.credentialPresent).toBe(true);
    expect(JSON.stringify(shown)).not.toContain("not-a-real-key");

    delete process.env[KEY_VARIABLE];
    expect((await settings.call({}, OWNER)).credentialPresent).toBe(false);
    process.env[KEY_VARIABLE] = "not-a-real-key";
  });

  it("will not switch on without a model or without a budget", async () => {
    const noModel = await failure(
      updateSettings.call(
        {
          enabled: true,
          provider: "anthropic",
          maxOutputTokens: 300,
          spendCapCents: 500,
          spendPeriod: "month",
          repliesPerConversation: 20,
          repliesPerHour: 60,
        },
        OWNER,
      ),
    );
    expect(noModel.message).toContain("model");

    const noBudget = await failure(configure({ spendCapCents: 0 }));
    expect(noBudget.message).toContain("limit");
  });

  it("shows an owner every attempt, refusals included", async () => {
    await configure({ repliesPerConversation: 1 });
    stubModel({ reply: "Once." });
    const chat = await startChat("ledger@example.com");
    await answer.call({ token: chat.token }, ANONYMOUS);
    await postSiteChat.call({ token: chat.token, message: "Again?" }, ANONYMOUS);
    await answer.call({ token: chat.token }, ANONYMOUS);

    const listed = await turns.call({ limit: 10 }, OWNER);
    expect(listed.map((entry) => entry.outcome)).toEqual([
      "refused_conversation_cap",
      "answered",
    ]);
  });

  it("keeps its meter out of an unrelated conversation's way", async () => {
    await configure({ repliesPerConversation: 1 });
    stubModel({ reply: "Hello." });
    const first = await startChat("one@example.com");
    await answer.call({ token: first.token }, ANONYMOUS);

    const second = await startChat("two@example.com");
    const result = await answer.call({ token: second.token }, ANONYMOUS);

    expect(result.status).toBe("answered");
    const rows = await db()
      .select()
      .from(assistantTurns)
      .where(eq(assistantTurns.outcome, "answered"));
    expect(rows).toHaveLength(2);
  });
});
