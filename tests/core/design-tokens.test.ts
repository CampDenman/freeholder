// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-edited design tokens (C2.15).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { colors, contrastFailures, themeStylesheet } from "@/core/design/tokens";
import { getDesign, resetDesign, resolveTheme, updateDesign } from "@/core/design/service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("resolved token contrast", () => {
  it("Bench itself has no WCAG failures", () => {
    expect(contrastFailures(colors)).toEqual([]);
  });

  it("flags an unreadable ink on paper", () => {
    const theme = resolveTheme({
      light: { ink: "#f0f0f0", paper: "#ffffff" },
    });
    expect(contrastFailures(theme).some((row) => row.pair.startsWith("ink on"))).toBe(true);
  });

  it("emits extras on the stylesheet", () => {
    const sheet = themeStylesheet(colors, { measure: "56rem", gutter: "2rem" });
    expect(sheet).toContain("--fh-measure: 56rem;");
    expect(sheet).toContain("--fh-gutter: 2rem;");
  });
});

describe.runIf(hasDatabase)("design settings", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("saves a valid accent and refuses an unreadable pairing", async () => {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
      },
      OWNER,
    );

    const saved = await updateDesign.call(
      { colors: { light: { accent: "#1d4ed8" }, dark: { accent: "#93c5fd" } } },
      OWNER,
    );
    expect(saved.theme.light.accent).toBe("#1d4ed8");
    expect(saved.theme.dark.accent).toBe("#93c5fd");

    const refused = await failure(
      updateDesign.call({ colors: { light: { ink: "#eeeeee", paper: "#ffffff" } } }, OWNER),
    );
    expect(refused.code).toBe("validation");

    await resetDesign.call({}, OWNER);
    const restored = await getDesign.call({}, OWNER);
    expect(restored.origin).toBe("system");
    expect(restored.theme.light.accent).toBe(colors.light.accent);
  });

  it("refuses font stacks that can escape their CSS declaration", async () => {
    const refused = await failure(
      updateDesign.call(
        { fontSans: 'system-ui; background: url("https://attacker.invalid/seen")' },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");

    const saved = await updateDesign.call(
      { fontSans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
      OWNER,
    );
    expect(saved.extras.fontSans).toBe(
      'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    );
  });
});
