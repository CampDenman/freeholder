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
//
// Through the service layer, not the database (§15.5). The request-scoped reads
// are the same ones the layout uses, so naming the site here costs no extra
// query, and `media.resolveImage` is how the logo block resolves the very same
// asset.
import type { MetadataRoute } from "next";
import { currentBusiness } from "@/core/settings/read";
import { currentDesign } from "@/core/design/read";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "Freeholder";
  let icons: MetadataRoute.Manifest["icons"];

  try {
    const business = await currentBusiness();
    if (business?.name) name = business.name;

    const design = await currentDesign();
    if (design.logoAssetId) {
      const { resolveImage } = await import("@/core/media/service");
      const image = await resolveImage.call(
        { id: design.logoAssetId },
        { kind: "anonymous" },
      );
      if (image) {
        // `sizes: "any"` rather than a declared pixel size: the logo is
        // whatever the owner uploaded, and claiming a size nobody measured
        // would be worse than claiming none.
        icons = [{ src: image.src, sizes: "any" }];
      }
    }
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
