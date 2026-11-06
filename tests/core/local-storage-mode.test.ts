// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.44: one rule for when production media may live on local disk.
import { describe, expect, it } from "vitest";
import { describeLocalStorage, localStorageMode } from "@/adapters/storage/local-mode";

describe("local storage mode", () => {
  it("is development outside production", () => {
    expect(localStorageMode({ NODE_ENV: "development" })).toBe("development");
    expect(localStorageMode({ NODE_ENV: "test", LOCAL_STORAGE_ROOT: "relative" })).toBe("development");
  });

  it("accepts only an absolute directory in production, and still honours the legacy override", () => {
    expect(localStorageMode({ NODE_ENV: "production", LOCAL_STORAGE_ROOT: "/var/lib/freeholder/media" })).toBe("persistent");
    expect(localStorageMode({ NODE_ENV: "production", LOCAL_STORAGE_ROOT: ".data/media" })).toBe("refused");
    expect(localStorageMode({ NODE_ENV: "production" })).toBe("refused");
    expect(localStorageMode({ NODE_ENV: "production", FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1" })).toBe("unsafe");
  });

  it("tells the owner where the media is and that backups must include it", () => {
    const detail = describeLocalStorage({ NODE_ENV: "production", LOCAL_STORAGE_ROOT: "/var/lib/freeholder/media" });
    expect(detail).toContain("/var/lib/freeholder/media");
    expect(detail).toMatch(/backup/i);
    expect(describeLocalStorage({ NODE_ENV: "production" })).toMatch(/lose/);
  });
});
