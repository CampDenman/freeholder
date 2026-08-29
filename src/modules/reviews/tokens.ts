// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Review request links (C8.09).
//
// The same shape gallery guests use: high-entropy random, stored as an HMAC.
// A dumped table must not be a stack of working review links.
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

export function newReviewToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashReviewToken(token: string): string {
  const secret = env().SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to issue review request links.");
  }
  return createHmac("sha256", secret)
    .update(`freeholder:review-request:v1\0${token}`)
    .digest("hex");
}
