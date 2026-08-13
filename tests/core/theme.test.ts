// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Light and dark as a platform standard. The subtlety worth pinning is that
// "system" is the *absence* of a stored preference, not a third stored value.
import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  THEME_PREFERENCES,
  themeAttribute,
} from "@/core/design/theme";
import { t } from "@/core/i18n";

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

  it("has a catalog entry naming every preference", () => {
    // The names live in the message catalogs, not in a Record of English in
    // src/ — `t` returns the key itself when a string is missing, so a
    // preference nobody translated fails here rather than rendering
    // "theme.light" at a visitor.
    for (const preference of THEME_PREFERENCES) {
      const key = `theme.${preference}`;
      expect(t("en", key)).not.toBe(key);
    }
  });
});
