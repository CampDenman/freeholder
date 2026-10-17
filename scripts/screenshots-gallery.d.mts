// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface GalleryShot {
  route: string;
  url: string;
  role: "public" | "owner" | "customer";
  title: string;
  slug: string;
  files: string[];
}

export interface GalleryBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: GalleryBlock[];
}

export interface GalleryPage {
  slug: string;
  title: string;
  blocks: GalleryBlock[];
  seo: { title: string; description: string };
}

export function buildPages(
  shots: GalleryShot[],
  assetFor: (file: string) => string,
  meta: { capturedAt?: string; commit?: string | null },
): GalleryPage[];
