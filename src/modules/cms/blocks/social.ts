// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Allowlisted social embed URLs (C2.08). Arbitrary iframes are HTML soup.
export type SocialProvider = "youtube" | "vimeo";

export function socialEmbed(url: string): { provider: SocialProvider; src: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0];
    if (id && /^[\w-]{6,}$/.test(id)) {
      return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const fromPath =
      parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live"
        ? parts[1]
        : undefined;
    const id = parsed.searchParams.get("v") ?? fromPath;
    if (id && /^[\w-]{6,}$/.test(id)) {
      return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.split("/").filter((part) => /^\d+$/.test(part))[0];
    if (id) return { provider: "vimeo", src: `https://player.vimeo.com/video/${id}` };
  }
  return null;
}
