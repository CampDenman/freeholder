// SPDX-License-Identifier: AGPL-3.0-only
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

  it("rejects unknown adapters", () => {
    expect(() =>
      defineConfig({ adapters: { payments: "square" as never } }),
    ).toThrow();
  });

  it("the checked-in instance config is valid", () => {
    expect(instanceConfig.baseCurrency).toHaveLength(3);
  });
});
