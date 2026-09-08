// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Instance discovery (MASTER.md §35.1, C10.12).
//
// §35.1: "The app is white-label but not single-tenant-compiled: it asks for
// the business's address, fetches `/.well-known/freeholder` for the name,
// branding and contract version, and refuses an instance whose contract is
// newer than the binary understands — with the store link to update, not a
// broken screen."
//
// So this document has exactly one job: let an app decide, before it renders
// anything, whether it can speak to this instance at all. It is public and
// unauthenticated, and therefore says nothing a signed-out visitor to the home
// page could not already see.

/**
 * The contract major an app must understand to talk to this instance.
 *
 * Bumped only when the shape an app depends on changes incompatibly — not on
 * every release, because an app that refuses to start after a routine patch
 * teaches its users to distrust updates. Apps compare majors and nothing else.
 */
export const CONTRACT_VERSION = 1;

export interface DiscoveryDocument {
  freeholder: true;
  contractVersion: number;
  platformVersion: string;
  name: string;
  tagline: string | null;
  locales: { default: string; enabled: string[] };
  currency: string;
  timezone: string;
  country: string;
  branding: {
    logoUrl: string | null;
    /** Semantic tokens, light and dark, so the app never invents a colour. */
    colors: Record<string, string>;
    fontSans: string | null;
  };
  api: { base: string; openapi: string; mcp: string };
  /** Where to send someone whose binary is too old. */
  storeUrls: { ios: string | null; android: string | null };
}

export type Compatibility =
  | { ok: true }
  | { ok: false; reason: "too-old"; message: string }
  | { ok: false; reason: "not-freeholder"; message: string };

/**
 * Whether an app built against `appContract` may talk to this instance.
 *
 * An app that is *newer* than the instance is fine: the platform only ever
 * adds, and an owner who has not updated their instance yet should not be
 * locked out of their own app. An app that is *older* than a contract bump is
 * the case §35.1 cares about, and the answer is a store link rather than a
 * broken screen — the customer did nothing wrong and cannot fix it from here.
 */
export function checkCompatibility(
  document: Pick<DiscoveryDocument, "freeholder" | "contractVersion" | "name">,
  appContract: number,
): Compatibility {
  if (document.freeholder !== true || typeof document.contractVersion !== "number") {
    return {
      ok: false,
      reason: "not-freeholder",
      message: "That address does not look like a Freeholder site.",
    };
  }
  if (document.contractVersion > appContract) {
    return {
      ok: false,
      reason: "too-old",
      message: `${document.name} needs a newer version of this app. Update from the store and try again.`,
    };
  }
  return { ok: true };
}
