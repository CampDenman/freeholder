// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// High-entropy document share tokens (MASTER.md §4.5, C8.13).
//
// The same split `galleries/tokens.ts` makes, and for the same reason: a share
// token is 24 random bytes, so there is no dictionary to slow down and HMAC is
// enough. A password is a dictionary, so it goes through `hashPassword`
// instead — an HMAC of a password is a document that opens from a dumped hash.
//
// The domain string differs from the gallery one deliberately. A token minted
// for a gallery must not open a document even if the two hashes ever meet in
// the same column, and the cheapest way to guarantee that is to make the
// preimages incompatible.
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/core/env";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to issue document share links.");
  }
  return value;
}

export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`freeholder:document-share:v1\0${token}`)
    .digest("hex");
}
