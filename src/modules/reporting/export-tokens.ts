// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// High-entropy bearer credentials for recipient accounting-export downloads.
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to issue accounting export links.");
  }
  return value;
}

export function newExportToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashExportToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`freeholder:accounting-export:v1\0${token}`)
    .digest("hex");
}
