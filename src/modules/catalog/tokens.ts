// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// High-entropy catalog share tokens (C9.35).
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to issue catalog share tokens.");
  }
  return value;
}

export function newCatalogShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashCatalogShareToken(
  kind: "wishlist" | "gift-card",
  token: string,
): string {
  return createHmac("sha256", secret())
    .update(`freeholder:catalog-${kind}:v1\0${token}`)
    .digest("hex");
}
