// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-edited design tokens (C2.15). Singleton: one deploy, one brand.
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { assets } from "@/core/media/schema";
import type { ColorTokens } from "./tokens";

export interface DesignColorOverrides {
  light?: Partial<ColorTokens>;
  dark?: Partial<ColorTokens>;
}

export const designSettings = pgTable(
  "design_settings",
  {
    id: integer("id").primaryKey().default(1),
    colors: jsonb("colors").$type<DesignColorOverrides>().notNull().default({}),
    fontSans: text("font_sans"),
    fontMono: text("font_mono"),
    radius: text("radius"),
    motion: text("motion"),
    measure: text("measure"),
    gutter: text("gutter"),
    logoAssetId: uuid("logo_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [check("design_settings_singleton", sql`${t.id} = 1`)],
);
