// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.03/C11.10: possession of the deployment secret authorizes first ownership.
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";

export function requireBootstrapSecret(supplied?: string): void {
  const config = env();
  if (!config.BOOTSTRAP_SECRET && config.NODE_ENV !== "production") return;
  if (!config.BOOTSTRAP_SECRET) {
    throw new ServiceError("permission", "The operator must configure BOOTSTRAP_SECRET before creating the owner account.");
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!supplied || !timingSafeEqual(digest(supplied), digest(config.BOOTSTRAP_SECRET))) {
    throw new ServiceError("permission", "The setup secret is missing or incorrect.");
  }
}

export function bootstrapAttemptKey(secret?: string): string {
  return createHash("sha256").update(secret ?? "missing").digest("hex");
}
