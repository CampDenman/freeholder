// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Visual design controls over semantic tokens (C2.15).
import { z } from "zod";
import { eq } from "drizzle-orm";
import { uuid } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";

const colorTokens = z.object({
  paper: z.string(),
  surface: z.string(),
  surfaceMuted: z.string(),
  field: z.string(),
  ink: z.string(),
  inkMuted: z.string(),
  rule: z.string(),
  accent: z.string(),
  onAccent: z.string(),
  accentSoft: z.string(),
  success: z.string(),
  successSoft: z.string(),
  warning: z.string(),
  warningSoft: z.string(),
  danger: z.string(),
  dangerSoft: z.string(),
  focus: z.string(),
});

const designResult = z.object({
  theme: z.object({
    light: colorTokens,
    dark: colorTokens,
  }),
  extras: z.object({
    fontSans: z.string().optional(),
    fontMono: z.string().optional(),
    radius: z.string().optional(),
    motion: z.string().optional(),
    measure: z.string().optional(),
    gutter: z.string().optional(),
  }),
  logoAssetId: uuid.nullable(),
  origin: z.enum(["owner", "system"]),
});
import {
  COLOR_ROLES,
  HEX,
  colors,
  contrastFailures,
  type ColorTokens,
  type ThemeTokens,
  type TokenExtras,
} from "./tokens";
import { designSettings, type DesignColorOverrides } from "./schema";

const HEX_COLOR = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX, "use a six-digit hex colour such as #2551e0");

const colorPatch = z
  .object({
    paper: HEX_COLOR.optional(),
    surface: HEX_COLOR.optional(),
    surfaceMuted: HEX_COLOR.optional(),
    field: HEX_COLOR.optional(),
    ink: HEX_COLOR.optional(),
    inkMuted: HEX_COLOR.optional(),
    rule: HEX_COLOR.optional(),
    accent: HEX_COLOR.optional(),
    onAccent: HEX_COLOR.optional(),
    accentSoft: HEX_COLOR.optional(),
    success: HEX_COLOR.optional(),
    successSoft: HEX_COLOR.optional(),
    warning: HEX_COLOR.optional(),
    warningSoft: HEX_COLOR.optional(),
    danger: HEX_COLOR.optional(),
    dangerSoft: HEX_COLOR.optional(),
    focus: HEX_COLOR.optional(),
  })
  .strict();

const FONT = z.string().trim().min(1).max(160).refine((value) => !/[<>{}]/.test(value), {
  message: "a font stack cannot contain markup",
});

const RADIUS = z.enum(["0.25rem", "0.375rem", "0.5rem", "0.75rem"]);
const MOTION = z.enum(["120ms", "180ms", "0.01ms"]);
const MEASURE = z.enum(["36rem", "48rem", "56rem"]);
const GUTTER = z.enum(["1rem", "1.5rem", "2rem"]);

function mergeScheme(
  base: ColorTokens,
  patch: Partial<ColorTokens> | undefined,
): ColorTokens {
  const next = { ...base };
  if (!patch) return next;
  for (const role of COLOR_ROLES) {
    const value = patch[role];
    if (typeof value === "string" && HEX.test(value)) next[role] = value;
  }
  return next;
}

export function resolveTheme(overrides: DesignColorOverrides | null | undefined): ThemeTokens {
  return {
    light: mergeScheme(colors.light, overrides?.light),
    dark: mergeScheme(colors.dark, overrides?.dark),
  };
}

export function extrasFromRow(row: {
  fontSans: string | null;
  fontMono: string | null;
  radius: string | null;
  motion: string | null;
  measure: string | null;
  gutter: string | null;
}): TokenExtras {
  return {
    fontSans: row.fontSans ?? undefined,
    fontMono: row.fontMono ?? undefined,
    radius: row.radius ?? undefined,
    motion: row.motion ?? undefined,
    measure: row.measure ?? undefined,
    gutter: row.gutter ?? undefined,
  };
}

function refuseIfUnsafe(theme: ThemeTokens): void {
  const failures = contrastFailures(theme);
  if (failures.length === 0) return;
  const first = failures[0]!;
  const hundredths = Math.round(first.ratio * 100);
  const shown = `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
  throw new ServiceError(
    "validation",
    `That pairing fails WCAG ${first.scheme} ${first.pair} (${shown}:1, need ${first.need}:1).`,
  );
}

async function loadOrEmpty(tx: Tx) {
  const rows = await tx
    .select()
    .from(designSettings)
    .where(eq(designSettings.id, 1))
    .limit(1);
  return rows[0] ?? null;
}

export const getDesign = defineService({
  name: "settings.getDesign",
  summary: "The resolved brand tokens for this instance.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: designResult,
  handler: async (_input, ctx) => {
    const row = await loadOrEmpty(ctx.tx);
    const theme = resolveTheme(row?.colors);
    return {
      theme,
      extras: extrasFromRow(
        row ?? {
          fontSans: null,
          fontMono: null,
          radius: null,
          motion: null,
          measure: null,
          gutter: null,
        },
      ),
      logoAssetId: row?.logoAssetId ?? null,
      origin: row ? "owner" : "system",
    };
  },
});

export const updateDesign = defineService({
  name: "settings.updateDesign",
  summary: "Save brand token overrides. Refuses pairings that fail WCAG AA.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    colors: z
      .object({
        light: colorPatch.optional(),
        dark: colorPatch.optional(),
      })
      .optional(),
    fontSans: FONT.nullable().optional(),
    fontMono: FONT.nullable().optional(),
    radius: RADIUS.nullable().optional(),
    motion: MOTION.nullable().optional(),
    measure: MEASURE.nullable().optional(),
    gutter: GUTTER.nullable().optional(),
    logoAssetId: z.string().uuid().nullable().optional(),
  }),
  output: designResult,
  handler: async (input, ctx) => {
    const existing = await loadOrEmpty(ctx.tx);
    const nextColors: DesignColorOverrides = {
      light: { ...(existing?.colors.light ?? {}), ...(input.colors?.light ?? {}) },
      dark: { ...(existing?.colors.dark ?? {}), ...(input.colors?.dark ?? {}) },
    };
    const theme = resolveTheme(nextColors);
    refuseIfUnsafe(theme);

    const values = {
      colors: nextColors,
      fontSans: input.fontSans === undefined ? (existing?.fontSans ?? null) : input.fontSans,
      fontMono: input.fontMono === undefined ? (existing?.fontMono ?? null) : input.fontMono,
      radius: input.radius === undefined ? (existing?.radius ?? null) : input.radius,
      motion: input.motion === undefined ? (existing?.motion ?? null) : input.motion,
      measure: input.measure === undefined ? (existing?.measure ?? null) : input.measure,
      gutter: input.gutter === undefined ? (existing?.gutter ?? null) : input.gutter,
      logoAssetId:
        input.logoAssetId === undefined ? (existing?.logoAssetId ?? null) : input.logoAssetId,
    };

    const [saved] = existing
      ? await ctx.tx
          .update(designSettings)
          .set(values)
          .where(eq(designSettings.id, 1))
          .returning()
      : await ctx.tx.insert(designSettings).values({ id: 1, ...values }).returning();

    ctx.setSubject("design", "1");
    ctx.queueEvent("design.updated", { logoAssetId: saved!.logoAssetId });
    return {
      theme,
      extras: extrasFromRow(saved!),
      logoAssetId: saved!.logoAssetId,
      origin: "owner" as const,
    };
  },
});

export const resetDesign = defineService({
  name: "settings.resetDesign",
  summary: "Restore the Bench defaults.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: designResult,
  handler: async (_input, ctx) => {
    await ctx.tx.delete(designSettings).where(eq(designSettings.id, 1));
    ctx.setSubject("design", "1");
    ctx.queueEvent("design.reset", {});
    return {
      theme: colors,
      extras: extrasFromRow({
        fontSans: null,
        fontMono: null,
        radius: null,
        motion: null,
        measure: null,
        gutter: null,
      }),
      logoAssetId: null,
      origin: "system" as const,
    };
  },
});

export default [getDesign, updateDesign, resetDesign];
