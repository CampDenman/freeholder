// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// High-entropy referral invitation tokens (C9.09).
//
// The same shape gallery guests use, and for the same reason: the token is
// random, so HMAC is enough — there is no dictionary to slow down. It is
// returned once, at the moment the invitation is created, and only its hash
// is ever stored.
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to issue referral invitations.");
  }
  return value;
}

export function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`freeholder:referral-invitation:v1\0${token}`)
    .digest("hex");
}
