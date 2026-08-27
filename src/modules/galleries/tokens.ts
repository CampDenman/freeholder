// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// High-entropy gallery bearer tokens (C8.03).
//
// Guest and session tokens are random; HMAC is enough because there is no
// dictionary to slow down. PIN and password use `hashPassword` instead —
// four digits are a dictionary, and HMAC of a PIN is a gallery that opens
// from a dumped hash.
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to issue gallery access tokens.");
  }
  return value;
}

export function newGalleryToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashGalleryToken(kind: "guest" | "session", token: string): string {
  return createHmac("sha256", secret())
    .update(`freeholder:gallery-${kind}:v1\0${token}`)
    .digest("hex");
}


