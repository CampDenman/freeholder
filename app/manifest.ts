// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The installable identity of *this* site, not of the software running it.
//
// Both names were hard-coded to "Freeholder", so a customer who added a site to
// their phone's home screen got the platform's name under the icon instead of
// the business's. Reported by a third party after doing exactly that.
//
// Read from the business profile and the design theme, both of which the owner
// already fills in, so there is nothing new to configure. The logo doubles as
// the app icon when one is set: an owner who uploaded their logo has already
// answered "what should this look like".
import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { assets } from "@/core/media/schema";
import { businessProfile } from "@/core/settings/schema";
import { designSettings } from "@/core/design/schema";

export const dynamic = "force-dynamic";

/** The icon the owner already uploaded, if they uploaded one. */
async function logoIcon(): Promise<MetadataRoute.Manifest["icons"]> {
  const [theme] = await db()
    .select({ logoAssetId: designSettings.logoAssetId })
    .from(designSettings)
    .limit(1);
  if (!theme?.logoAssetId) return undefined;

  const [asset] = await db()
    .select({ storageKey: assets.storageKey, mime: assets.mime })
    .from(assets)
    .where(eq(assets.id, theme.logoAssetId))
    .limit(1);
  if (!asset) return undefined;

  // `sizes: "any"` rather than a declared pixel size: the original is whatever
  // the owner uploaded, and claiming a size nobody verified would be worse
  // than claiming none.
  return [{ src: `/media/${asset.storageKey}`, type: asset.mime, sizes: "any" }];
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "Freeholder";
  let icons: MetadataRoute.Manifest["icons"];
  try {
    const [business] = await db()
      .select({ name: businessProfile.name })
      .from(businessProfile)
      .limit(1);
    if (business?.name) name = business.name;
    icons = await logoIcon();
  } catch {
    // Before setup, and during a database outage, there is no business to name.
    // Naming the software is a poor answer; failing the route is a worse one,
    // because then the browser has nothing to install at all.
  }

  return {
    name,
    // Launchers truncate hard, so this is shortened deliberately rather than
    // cut mid-word by whichever home screen is doing the cutting.
    short_name: name.length > 12 ? `${name.slice(0, 11).trimEnd()}…` : name,
    start_url: "/",
    display: "standalone",
    ...(icons ? { icons } : {}),
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [{ name: "media", accept: ["image/*", "video/*", "audio/*"] }],
      },
    },
  };
}
