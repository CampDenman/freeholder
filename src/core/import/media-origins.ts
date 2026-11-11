// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: explicit media consent never expands the page-crawl origin.
import { z } from "zod";
import { isIP } from "node:net";
import { isPublicIpAddress, normalizeIpAddress } from "@/core/webhooks/address";
import { assertPublicHttpUrl } from "./contract";

export const mediaOriginSchema = z.string().max(2_048).transform((value, ctx) => {
  try {
    const url = assertPublicHttpUrl(value);
    if (isIP(normalizeIpAddress(url.hostname)) && !isPublicIpAddress(url.hostname)) throw new Error("Use a publicly routable media origin.");
    if (url.pathname !== "/" || url.search || url.hash) throw new Error("Use an origin without a path, query or fragment.");
    return url.origin;
  } catch (error) {
    ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Use a public media origin." });
    return z.NEVER;
  }
});
export const approvedMediaOriginsSchema = z.array(mediaOriginSchema).max(8);

export function approvedMediaOrigins(checkpoint: unknown): string[] {
  const stored = checkpoint && typeof checkpoint === "object" ? (checkpoint as Record<string, unknown>).approvedMediaOrigins : undefined;
  return approvedMediaOriginsSchema.parse(stored ?? []);
}

export function allowedMediaOrigins(origin: string, approved: string[] = []): Set<string> {
  return new Set([assertPublicHttpUrl(origin).origin, ...approvedMediaOriginsSchema.parse(approved)]);
}
