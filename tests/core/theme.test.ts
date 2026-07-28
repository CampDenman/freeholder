// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Light and dark as a platform standard. The subtlety worth pinning is that
// "system" is the *absence* of a stored preference, not a third stored value.
import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  THEME_LABELS,
  THEME_PREFERENCES,
  themeAttribute,
} from "@/core/design/theme";

describe("parseThemePreference()", () => {
  it("accepts the three real preferences", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    // A cookie is user-editable, so this is untrusted input like any other.
    for (const junk of [
      undefined,
      null,
      "",
      "LIGHT",
      "solarized",
      "__proto__",
      "constructor",
    ]) {
      expect(parseThemePreference(junk)).toBe("system");
    }
  });
});

describe("themeAttribute()", () => {
  it("stamps nothing for system, so the media query keeps deciding", () => {
    // Storing a resolved value would freeze the choice at whatever the OS
    // happened to be when the visitor first arrived.
    expect(themeAttribute("system")).toBeUndefined();
  });

  it("stamps the explicit choice so it can override the media query", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("the preference set", () => {
  it("puts system first, because it is the default", () => {
    expect(THEME_PREFERENCES[0]).toBe("system");
  });

  it("labels every preference", () => {
    for (const preference of THEME_PREFERENCES) {
      expect(THEME_LABELS[preference]).toBeTruthy();
    }
  });
});
