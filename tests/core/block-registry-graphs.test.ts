// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The block registry survives being compiled into more than one module graph.
//
// The bug: the bundler gives each graph its own copy of the registry module.
// Built-in blocks are a literal in every copy and so always resolved; blocks a
// module contributes arrive by mutating state at boot, so they existed in
// exactly one copy. `parseBlockTree` is synchronous and cannot await `ready()`
// the way `src/core/runtime.ts` has services do, so it read whichever copy its
// caller was compiled into — and a published page using a module block failed
// with "no block type is registered", in the standalone build only.
//
// `vi.resetModules()` is the closest thing to a second graph a unit test has:
// it forces a fresh evaluation of the module and everything it imports, which
// is exactly what a second bundle does.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ready } from "@/core/runtime";

const REGISTRY = "@/modules/cms/blocks/registry";

describe("the block registry across module graphs", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows a module's blocks to a second copy of the registry", async () => {
    // Graph one: boot, which is what registers module-contributed blocks.
    await ready();
    const first = await import(REGISTRY);
    expect(first.blockTypes()).toContain("portfolioIndex");

    // Graph two: a fresh evaluation that never booted, the way a page render
    // bundle never runs instrumentation's copy of anything.
    vi.resetModules();
    const second = await import(REGISTRY);
    expect(second).not.toBe(first);

    expect(second.blockTypes()).toContain("portfolioIndex");
    expect(second.getBlock("portfolioIndex")).toBeTruthy();
  });

  it("validates a module block from a graph that never booted", async () => {
    await ready();
    vi.resetModules();
    const { parseBlockTree } = await import(REGISTRY);

    // The exact shape that failed: a built-in first, a module block second.
    // Before the fix this threw on blocks[1] while blocks[0] passed, because
    // built-ins are a literal in every copy and registrations were not.
    expect(() =>
      parseBlockTree(
        [
          { id: "h", type: "heading", props: { text: "Our work", level: 1 } },
          { id: "p", type: "portfolioIndex", props: {} },
        ],
        "page",
        "blocks",
      ),
    ).not.toThrow();
  });

  it("still refuses a block type nobody registered", async () => {
    await ready();
    const { parseBlockTree } = await import(REGISTRY);
    // The guarantee the sharing must not erode: an unknown block is refused
    // rather than dropped, so disabling a plugin cannot silently delete a
    // section on the next save.
    expect(() =>
      parseBlockTree([{ id: "x", type: "notARealBlock", props: {} }], "page", "blocks"),
    ).toThrow(/no block type "notARealBlock" is registered/);
  });
});

describe("registering the same block from two graphs", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("treats a second graph's copy of one module as the same registration", async () => {
    const { registerBlock, getBlock } = await import(REGISTRY);
    const shape = { type: "twoGraphProbe", labelKey: "x", contexts: ["page"] };
    // Two equal-but-not-identical objects, which is exactly what two bundles
    // of the same module produce.
    registerBlock({ ...shape } as never, "probeModule");
    expect(() => registerBlock({ ...shape } as never, "probeModule")).not.toThrow();
    expect(getBlock("twoGraphProbe")).toBeTruthy();
  });

  it("still refuses two different modules claiming one type", async () => {
    const { registerBlock } = await import(REGISTRY);
    const shape = { type: "contestedProbe", labelKey: "x", contexts: ["page"] };
    registerBlock({ ...shape } as never, "moduleOne");
    // The guarantee that must survive: whichever module loaded last would
    // otherwise silently own an owner's existing content.
    expect(() => registerBlock({ ...shape } as never, "moduleTwo")).toThrow(
      /registered twice, by two different definitions/,
    );
  });
});
