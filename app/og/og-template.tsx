// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Auto-generated Open Graph images (MASTER.md §5).
//
// A branded card plus the entity title. Colours come from the same semantic
// tokens as the site — never a one-off palette that only works on one ground.
// The image is a document, not a theme toggle, so it always uses the light
// set: social crawlers do not honour `prefers-color-scheme`.
import { ImageResponse } from "next/og";
import { colors } from "@/core/design/tokens";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export function ogImageResponse(input: {
  title: string;
  siteName: string;
  tagline?: string | null;
}): ImageResponse {
  const theme = colors.light;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: theme.paper,
          color: theme.ink,
          padding: "72px 80px",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            letterSpacing: 1,
            color: theme.accent,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {input.siteName}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: input.title.length > 48 ? 56 : 72,
              lineHeight: 1.1,
              letterSpacing: -1,
            }}
          >
            {input.title}
          </div>
          {input.tagline ? (
            <div
              style={{
                display: "flex",
                fontSize: 28,
                color: theme.inkMuted,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {input.tagline}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: OG_WIDTH, height: OG_HEIGHT },
  );
}
