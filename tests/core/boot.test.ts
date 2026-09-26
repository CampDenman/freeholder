// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The boot sequence (MASTER.md §11). Until this existed the registry was built
// but never populated: every service in core was unreachable through the
// choke point that the API, admin UI and MCP server are all supposed to share.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { boot, bootOnce, resetBootForTests } from "@/core/boot";
import coreManifest from "@/core/manifest";
import { PLATFORM_VERSION } from "@/core/platform";
import { eventListeners, publish, resetBusForTests } from "@/core/events";
import type { ModuleManifest } from "@/core/module";
import {
  defineService,
  getService,
  listServices,
  resetRegistryForTests,
} from "@/core/service";

const noop = defineService({
  name: "demo.noop",
  summary: "Does nothing.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  handler: async () => null,
});

const demoModule = (over: Partial<ModuleManifest> = {}): ModuleManifest => ({
  name: "demo",
  version: "1.0.0",
  services: async () => ({ default: [noop] }),
  ...over,
});

beforeEach(() => {
  resetRegistryForTests();
  resetBusForTests();
  resetBootForTests();
});

describe("boot()", () => {
  it("registers every core service through the registry", async () => {
    const report = await boot([coreManifest]);

    expect(report.modules).toEqual(["core"]);
    expect(report.services).toEqual(
      expect.arrayContaining([
        "auth.registerOwner",
        "auth.login",
        "auth.logout",
        "auth.whoami",
        "contacts.create",
        "contacts.resolve",
        "contacts.merge",
        "contacts.update",
        "contacts.get",
        "contacts.list",
      ]),
    );
    expect(listServices().size).toBe(report.services.length);
    // Reachable by name is the point: this is how the API and MCP find them.
    expect(getService("contacts.resolve").def.permission).toBe("scoped");
  });

  it("wires modules in dependency order", async () => {
    const report = await boot([
      demoModule({ name: "quotes", requires: ["invoicing"], services: undefined }),
      demoModule({ name: "invoicing", services: undefined }),
    ]);
    expect(report.modules).toEqual(["invoicing", "quotes"]);
  });

  it("subscribes declared listeners and delivers to them", async () => {
    const received: unknown[] = [];
    const report = await boot([
      demoModule({
        events: { listens: { "invoice.paid": "onInvoicePaid" } },
        services: async () => ({
          default: [noop],
          onInvoicePaid: (payload: unknown) => void received.push(payload),
        }),
      }),
    ]);

    expect(report.listeners).toEqual([
      { event: "invoice.paid", module: "demo", handler: "onInvoicePaid" },
    ]);
    expect(eventListeners("invoice.paid").map((listener) => listener.id)).toEqual([
      "demo:invoice.paid:onInvoicePaid",
    ]);
    await publish("invoice.paid", { invoiceId: "inv_1" });
    expect(received).toEqual([{ invoiceId: "inv_1" }]);
  });

  it("names the module when its services module has no default export", async () => {
    await expect(
      boot([demoModule({ services: async () => ({ createThing: () => null }) })]),
    ).rejects.toThrow(/module "demo" declares services, but .* no default export/);
  });

  it("rejects anything in the list that is not a service", async () => {
    await expect(
      boot([
        demoModule({
          services: async () => ({ default: [{ notAService: true }] }),
        }),
      ]),
    ).rejects.toThrow(/must come from defineService/);
  });

  it("names a listener whose handler was never exported", async () => {
    await expect(
      boot([demoModule({ events: { listens: { "invoice.paid": "missing" } } })]),
    ).rejects.toThrow(/listens for "invoice.paid" with "missing"/);
  });

  it("refuses to boot a module whose dependency is absent", async () => {
    await expect(
      boot([demoModule({ name: "quotes", requires: ["invoicing"] })]),
    ).rejects.toThrow(/requires "invoicing", which is not installed/);
  });
});

describe("a plugin that cannot be wired", () => {
  // A plugin is isolated rather than fatal, which is right. What was wrong is
  // that the disable left no trace a machine could act on: it was appended to
  // the module name, so `modules.length` counted it and readiness answered ok.
  // A third party deploying Freeholder hit exactly that — the new instance
  // could not reach the database, its plugin was disabled, nothing was logged,
  // and the platform promoted the broken instance over the healthy one it was
  // replacing, 36 routes short.
  const plugin = (over: Record<string, unknown>): ModuleManifest =>
    ({
      name: "sinking",
      version: "1.0.0",
      kind: "plugin",
      license: "Apache-2.0",
      ...over,
    }) as unknown as ModuleManifest;

  // Fits the instance, then throws while loading. This is the reported
  // scenario: the plugin was fine until it could not reach the database.
  const throwsOnLoad = () =>
    plugin({
      freeholder: `^${PLATFORM_VERSION}`,
      services: async () => {
        throw new Error("no database");
      },
    });

  // Refused before loading, because it does not fit this instance at all.
  const doesNotFit = () => plugin({ freeholder: ">=99.0.0" });

  it("records a load failure as its own fact, with a reason", async () => {
    const report = await boot([throwsOnLoad()]);
    expect(report.disabled).toEqual([
      { module: "sinking", reason: expect.stringContaining("no database") },
    ]);
  });

  it("records a plugin that does not fit this instance", async () => {
    const report = await boot([doesNotFit()]);
    expect(report.disabled).toHaveLength(1);
    expect(report.disabled[0]!.module).toBe("sinking");
  });

  it("still boots, so one bad plugin is not a downed instance", async () => {
    const report = await boot([throwsOnLoad(), demoModule()]);
    expect(report.modules).toContain("demo");
    expect(report.disabled).toHaveLength(1);
  });

  // The count is what readiness reads, and a clean boot must report zero or
  // `/api/health` would answer 503 on every healthy instance.
  it("reports nothing disabled when every module wires", async () => {
    const report = await boot([demoModule()]);
    expect(report.disabled).toEqual([]);
  });
});
describe("bootOnce()", () => {
  it("boots a single time however often it is called", async () => {
    const [first, second] = await Promise.all([
      bootOnce([coreManifest]),
      bootOnce([coreManifest]),
    ]);
    expect(first).toBe(second);
    // A second registration of the same service would have thrown.
    expect(await bootOnce([coreManifest])).toBe(first);
    expect(listServices().size).toBe(first.services.length);
  });
});
