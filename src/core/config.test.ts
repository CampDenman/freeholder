// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { defineConfig } from "@/core/config";
import instanceConfig from "../../freeholder.config";

describe("defineConfig", () => {
  it("applies documented defaults (MASTER.md §17)", () => {
    const c = defineConfig({});
    expect(c.target).toBe("local");
    expect(c.adapters.payments).toBe("manual");
    expect(c.adapters.storage).toBe("local");
    expect(c.locales).toEqual(["en"]);
  });

  it("accepts every installed payment adapter and rejects unknown ones", () => {
    for (const payments of ["manual", "stripe", "paypal", "square", "mollie", "razorpay", "paystack", "flutterwave"] as const) {
      expect(defineConfig({ adapters: { payments } }).adapters.payments).toBe(payments);
    }
    expect(() =>
      defineConfig({ adapters: { payments: "unknown" as never } }),
    ).toThrow();
  });

  it("the checked-in instance config is valid", () => {
    expect(instanceConfig.baseCurrency).toHaveLength(3);
  });
});

describe("the builder adapter (§37)", () => {
  it("is off unless somebody chooses it", () => {
    // A platform that ships an agent able to change the site, enabled by
    // default, has made that decision for its owner.
    expect(defineConfig({}).adapters.agent).toBe("none");
  });

  it("accepts our default without making it everyone's", () => {
    expect(defineConfig({ adapters: { agent: "pm_brain" } }).adapters.agent).toBe(
      "pm_brain",
    );
    expect(defineConfig({ adapters: { agent: "local" } }).adapters.agent).toBe(
      "local",
    );
  });

  it("is a separate choice from the content-assist model", () => {
    // Grounding answers and writing changes are different jobs carrying
    // different risk, so they are not one setting.
    const config = defineConfig({
      adapters: { ai: "anthropic", agent: "none" },
    });
    expect(config.adapters.ai).toBe("anthropic");
    expect(config.adapters.agent).toBe("none");
  });

  it("rejects an unknown builder rather than silently ignoring it", () => {
    expect(() =>
      defineConfig({ adapters: { agent: "some-model" as "none" } }),
    ).toThrow();
  });
});
