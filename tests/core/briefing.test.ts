// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The daily briefing (C4.15, MASTER.md §42): assembled before anybody arrives,
// ordered needs-me-first, quiet when there is nothing to say, and hideable
// without switching off the work behind it.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { briefings, briefingContributions } from "@/core/briefing/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { defineService, registerService } from "@/core/service";
import type * as BriefingRegistry from "@/core/briefing/registry";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

/** What each fake contributor will say when it is next asked. */
const answers = new Map<string, unknown>();

function contributor(name: string) {
  return defineService({
    name,
    summary: `Test briefing contributor ${name}.`,
    kind: "query",
    permission: "public",
    mcpExclude: true,
    input: z.object({
      userId: z.uuid(),
      onDate: z.string(),
      timezone: z.string(),
    }),
    output: z.unknown(),
    handler: async () => {
      const answer = answers.get(name);
      if (answer === "throw") throw new Error("this contributor is broken");
      return answer ?? null;
    },
  });
}

const OVERDUE = "test.briefingOverdue";
const TODAY = "test.briefingToday";
const NEWS = "test.briefingNews";
const BROKEN = "test.briefingBroken";

// Only the collector is replaced, so everything downstream of it is the real
// path: the assembler still resolves each contributor through the service
// registry, validates what comes back against the contract, and stores it.
// What the collector itself reads out of module manifests is pinned
// separately, below, against the manifests this instance actually has.
vi.mock("@/core/briefing/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof BriefingRegistry>();
  return {
    ...actual,
    briefingContributors: async () =>
      [
        "test.briefingOverdue",
        "test.briefingToday",
        "test.briefingNews",
        "test.briefingBroken",
      ].map((service, index) => ({
        key: service,
        service,
        source: "module" as const,
        position: 100 + index,
      })),
  };
});

describe("the contributor registry", () => {
  it("reads contributors out of the manifests this instance actually has", async () => {
    const { briefingContributors } =
      await vi.importActual<typeof BriefingRegistry>("@/core/briefing/registry");
    const found = await briefingContributors();
    // Core's own sections are C4.16 and no module declares one yet, so today
    // the honest answer is none — an empty briefing rather than a broken one,
    // which is what an instance with every module switched off should get.
    expect(found).toEqual([]);
  });

  it("orders by what it costs the person to miss it", async () => {
    const { SEVERITY_ORDER } =
      await vi.importActual<typeof BriefingRegistry>("@/core/briefing/registry");
    expect(SEVERITY_ORDER.attention).toBeLessThan(SEVERITY_ORDER.today!);
    expect(SEVERITY_ORDER.today).toBeLessThan(SEVERITY_ORDER.changed!);
  });

  it("treats an empty section and silence as the same answer", async () => {
    const { briefingContribution } =
      await vi.importActual<typeof BriefingRegistry>("@/core/briefing/registry");
    expect(briefingContribution.parse(null)).toBeNull();
    // Defaults exist so a contributor only has to say the interesting part.
    expect(briefingContribution.parse({ title: "Something" })).toMatchObject({
      items: [],
      severity: "changed",
    });
    expect(() => briefingContribution.parse({ title: "" })).toThrow();
  });
});

let services: ReturnType<typeof contributor>[] = [];

describe.runIf(hasDatabase)("daily briefing", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    if (services.length === 0) {
      services = [OVERDUE, TODAY, NEWS, BROKEN].map(contributor);
      for (const service of services) registerService(service);
    }
    answers.clear();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(closeDb);

  async function assemble() {
    const { assembleBriefing } = await import("@/core/briefing/service");
    return assembleBriefing.call({ userId: OWNER.userId, onDate: "2026-09-14" }, SYSTEM);
  }

  async function read() {
    const { readBriefing } = await import("@/core/briefing/service");
    return readBriefing.call({ onDate: "2026-09-14" }, OWNER);
  }

  it("puts what needs you above what is today, above what merely changed", async () => {
    answers.set(NEWS, { title: "What changed", items: [{ label: "Two new pages" }] });
    answers.set(TODAY, { title: "Today", severity: "today", items: [{ label: "One call" }] });
    answers.set(OVERDUE, {
      title: "Overdue invoices",
      severity: "attention",
      items: [{ label: "Rae Lane", href: "/admin/invoices/1", detail: "£400, 12 days" }],
    });

    expect(await assemble()).toMatchObject({ sections: 3, status: "ready" });
    const briefing = await read();
    // The declaration order was overdue, today, news; the *reading* order is
    // by what it costs the person to miss it.
    expect(briefing?.sections.map((section) => section.severity)).toEqual([
      "attention",
      "today",
      "changed",
    ]);
    expect(briefing?.sections[0]?.items[0]).toMatchObject({
      label: "Rae Lane",
      href: "/admin/invoices/1",
    });
  });

  it("leaves out a contributor with nothing to say", async () => {
    answers.set(OVERDUE, null);
    answers.set(TODAY, { title: "Today", items: [] });
    answers.set(NEWS, { title: "What changed", items: [{ label: "One thing" }] });

    // Silence and an empty list are the same answer: a briefing that lists
    // everything is one nobody finishes.
    expect(await assemble()).toMatchObject({ sections: 1 });
    const briefing = await read();
    expect(briefing?.sections).toHaveLength(1);
    expect(briefing?.sections[0]?.title).toBe("What changed");
  });

  it("costs a broken contributor its own section and nothing else", async () => {
    answers.set(BROKEN, "throw");
    answers.set(OVERDUE, {
      title: "Overdue invoices",
      severity: "attention",
      items: [{ label: "Rae Lane" }],
    });

    // This is the screen that carries the warnings about the platform being
    // unhappy, so it has to survive one unhappy part of the platform.
    expect(await assemble()).toMatchObject({ sections: 1, status: "ready" });
    expect((await read())?.sections).toHaveLength(1);
  });

  it("refuses a contribution that does not fit the contract", async () => {
    answers.set(OVERDUE, { title: "", items: "not a list" });
    answers.set(NEWS, { title: "What changed", items: [{ label: "One thing" }] });
    expect(await assemble()).toMatchObject({ sections: 1 });
  });

  it("says nothing needs you rather than padding the page", async () => {
    expect(await assemble()).toMatchObject({ sections: 0, status: "ready" });
    const briefing = await read();
    expect(briefing?.status).toBe("ready");
    expect(briefing?.sections).toEqual([]);
  });

  it("hides a section for the person who hid it, without touching the work", async () => {
    const { setBriefingSection } = await import("@/core/briefing/service");
    answers.set(OVERDUE, { title: "Overdue invoices", severity: "attention", items: [{ label: "Rae" }] });
    answers.set(NEWS, { title: "What changed", items: [{ label: "One thing" }] });
    await assemble();

    await setBriefingSection.call({ key: OVERDUE, enabled: false }, OWNER);
    const hidden = await read();
    expect(hidden?.sections.map((section) => section.key)).toEqual([NEWS]);
    // Offered back rather than forgotten, and the row is still there: hiding
    // a section must not stop invoices being chased.
    expect(hidden?.hidden).toEqual([{ key: OVERDUE, title: "Overdue invoices" }]);
    const [row] = await db()
      .select()
      .from(briefingContributions)
      .where(eq(briefingContributions.key, OVERDUE));
    expect(row).toBeTruthy();

    await setBriefingSection.call({ key: OVERDUE, enabled: true }, OWNER);
    expect((await read())?.sections).toHaveLength(2);
  });

  it("keeps read state across a re-assembly of the same day", async () => {
    const { markBriefingRead } = await import("@/core/briefing/service");
    answers.set(NEWS, { title: "What changed", items: [{ label: "One thing" }] });
    const first = await assemble();
    await markBriefingRead.call({ id: first.id }, OWNER);
    expect((await read())?.readAt).not.toBeNull();

    answers.set(NEWS, { title: "What changed", items: [{ label: "Two things" }] });
    const again = await assemble();
    // One briefing per person per day: re-assembly replaces the sections
    // rather than producing a second Tuesday, and somebody who read this
    // morning's briefing has read it.
    expect(again.id).toBe(first.id);
    expect(await db().select().from(briefings)).toHaveLength(1);
    const reread = await read();
    expect(reread?.readAt).not.toBeNull();
    expect(reread?.sections[0]?.items[0]?.label).toBe("Two things");
  });

  it("is one person's, and is not assembled on request", async () => {
    answers.set(NEWS, { title: "What changed", items: [{ label: "One thing" }] });
    const mine = await assemble();

    const { assembleBriefing, markBriefingRead } = await import("@/core/briefing/service");
    // The scheduler builds these; a request that could would be a slow screen.
    expect(
      (await failure(assembleBriefing.call({ userId: OWNER.userId }, OWNER))).code,
    ).toBe("permission");

    const stranger = "00000000-0000-4000-8000-0000000000e1";
    await db()
      .insert(users)
      .values({ id: stranger, email: "stranger@example.test", role: "staff" });
    const refused = await failure(
      markBriefingRead.call(
        { id: mine.id },
        { kind: "user", userId: stranger, role: "staff", grants: [] },
      ),
    );
    expect(refused.code).toBe("not_found");
    const [untouched] = await db()
      .select()
      .from(briefings)
      .where(and(eq(briefings.id, mine.id), eq(briefings.userId, OWNER.userId)));
    expect(untouched?.readAt).toBeNull();
  });

  it("has nothing to show before the first one is built", async () => {
    expect(await read()).toBeNull();
  });
});
