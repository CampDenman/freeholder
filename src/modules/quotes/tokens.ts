// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// High-entropy quote partner tokens (C9.34).
//
// HMAC, not a password hash: these are random, so there is no dictionary to
// slow down. The prospect's own `view_token` is stored as issued (C6.12);
// partner links hash because they are minted after the quote has left, and a
// dumped table must not be a second copy of every share.
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to issue quote partner tokens.");
  }
  return value;
}

export function newQuotePartnerToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashQuotePartnerToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`freeholder:quote-partner:v1\0${token}`)
    .digest("hex");
}
