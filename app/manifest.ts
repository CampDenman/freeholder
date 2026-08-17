// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Freeholder",
    short_name: "Freeholder",
    start_url: "/",
    display: "standalone",
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
