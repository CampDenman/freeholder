// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The first screen of the mobile app talks to this (MASTER.md §35.1, C10.12).
//
// §35.1: the app "asks for the business's address, fetches
// `/.well-known/freeholder` for the name, branding and contract version, and
// refuses an instance whose contract is newer than the binary understands —
// with the store link to update, not a broken screen. A customer whose
// photographer moved domains types the new one; nobody reinstalls."
//
// Public and unauthenticated, and therefore carefully boring: it says nothing
// a signed-out visitor to the home page could not already read. No counts, no
// module list, no version of anything that would help someone decide which
// exploit to try — the platform version is here because an app has to know
// what it is talking to, and it is already in `/api/health`.
import { CONTRACT_VERSION, instanceLogoUrl, type DiscoveryDocument } from "@/core/discovery";
import { env } from "@/core/env";
import { PLATFORM_VERSION } from "@/core/platform";
import { currentBusiness } from "@/core/settings/read";
import { currentDesign } from "@/core/design/read";
import { resolveImage } from "@/core/media/service";

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const [business, design] = await Promise.all([currentBusiness(), currentDesign()]);
  // A loop rather than `/\/+$/`: that pattern backtracks polynomially on a
  // long run of slashes, and this value is read on every discovery request.
  const base = stripTrailingSlashes(env().APP_URL);

  // An instance that has not finished setup has no name to announce. Saying so
  // is better than announcing "Freeholder", which would send a customer to an
  // app home screen branded for a product rather than for their photographer.
  if (!business) {
    return Response.json(
      {
        freeholder: true,
        contractVersion: CONTRACT_VERSION,
        setupComplete: false,
        message: "This instance has not finished setup yet.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const logo = design.logoAssetId
    ? await resolveImage.call({ id: design.logoAssetId }, { kind: "anonymous" })
    : null;

  const document: DiscoveryDocument = {
    freeholder: true,
    contractVersion: CONTRACT_VERSION,
    platformVersion: PLATFORM_VERSION,
    name: business.name,
    tagline: business.tagline ?? null,
    locales: {
      default: business.defaultLocale,
      enabled: business.enabledLocales,
    },
    currency: business.baseCurrency,
    timezone: business.timezone,
    country: business.country,
    branding: {
      logoUrl: instanceLogoUrl(base, logo?.src),
      // The resolved semantic tokens, so the app never invents a colour and
      // never has to know which of them the owner overrode.
      colors: design.theme as unknown as Record<string, string>,
      fontSans: design.extras.fontSans ?? null,
    },
    api: {
      base: `${base}/api/v1`,
      openapi: `${base}/api/openapi.json`,
      mcp: `${base}/api/mcp`,
    },
    storeUrls: {
      ios: env().MOBILE_APP_STORE_URL ?? null,
      android: env().MOBILE_PLAY_STORE_URL ?? null,
    },
  };

  return Response.json(document, {
    headers: {
      // Short, not immutable: a rebrand should reach a phone the next time it
      // opens the app, not whenever a CDN feels like it.
      "cache-control": "public, max-age=300",
    },
  });
}
