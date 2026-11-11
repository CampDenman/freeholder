// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { NavigationLink } from "./navigation-tree";

export const navigationLinkSchema: z.ZodType<NavigationLink> = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  id: z.string().min(1).max(120).optional(),
});

export const navigationLinksSchema = z.array(navigationLinkSchema).superRefine((links, ctx) => {
  const ids = new Set<string>();
  let previousDepth = -1;
  for (const [index, link] of links.entries()) {
    const depth = link.depth ?? 0;
    if (depth > previousDepth + 1) ctx.addIssue({ code: "custom", path: [index, "depth"], message: "A nested menu item needs its parent immediately above it." });
    if (link.id && ids.has(link.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Menu item identities must be unique within the menu." });
    if (link.id) ids.add(link.id);
    previousDepth = depth;
  }
});
