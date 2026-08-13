// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Business identity and module toggles (MASTER.md §4.8, §13).
//
// The profile is readable by anyone because every public page needs it — the
// site's name, locale and currency are on the page already. Writing it is
// owner-only, and once setup completes the wizard's own step refuses to run
// again, so /setup cannot be replayed against a live business.
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { businessProfile, moduleSettings } from "@/core/settings/schema";
import { defineService, ServiceError } from "@/core/service";

const PROFILE_ID = 1;

/** BCP-47-ish: a language, optional script/region. Not a full parser. */
const locale = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
  message: "use a BCP-47 locale such as en, fr-CA or zh-Hant-TW",
});

const profileShape = {
  name: z.string().min(1),
  tagline: z.string().optional(),
  schemaType: z.string().min(1),
  country: z.string().length(2).toUpperCase(),
  defaultLocale: locale,
  enabledLocales: z.array(locale).min(1),
  baseCurrency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(1),
  units: z.enum(["metric", "imperial"]),
  firstDayOfWeek: z.number().int().min(0).max(6),
};

/** Creation fills in the fields the wizard does not ask about. */
const createProfile = z.object({
  ...profileShape,
  schemaType: profileShape.schemaType.default("LocalBusiness"),
  defaultLocale: profileShape.defaultLocale.default("en"),
  enabledLocales: profileShape.enabledLocales.default(["en"]),
  units: profileShape.units.default("metric"),
  firstDayOfWeek: profileShape.firstDayOfWeek.default(1),
});

/**
 * Patching uses the shape *without* defaults. `.partial()` does not remove a
 * `.default()`, so patching from the creation schema would quietly resupply
 * every default: changing a tagline would reset the business's locale, units
 * and first day of week. The two schemas are separate for that reason alone.
 */
const patchProfile = z.object(profileShape).partial();

export const getBusiness = defineService({
  name: "settings.getBusiness",
  summary: "The business profile every public page renders from.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [profile] = await ctx.tx
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.id, PROFILE_ID))
      .limit(1);
    return profile ?? null;
  },
});

/**
 * What first boot still needs. Public, because /setup has to ask before anyone
 * can possibly be signed in — and it deliberately answers only yes/no
 * questions, never who the owner is.
 */
export const setupState = defineService({
  name: "settings.setupState",
  summary: "What first-boot setup still requires.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [owner] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"))
      .limit(1);
    const [profile] = await ctx.tx
      .select({ completedAt: businessProfile.setupCompletedAt })
      .from(businessProfile)
      .where(eq(businessProfile.id, PROFILE_ID))
      .limit(1);
    return {
      hasOwner: Boolean(owner),
      hasBusiness: Boolean(profile),
      completed: Boolean(profile?.completedAt),
    };
  },
});

export const updateBusiness = defineService({
  name: "settings.updateBusiness",
  summary: "Create or change the business profile.",
  kind: "mutation",
  permission: "scoped",
  input: createProfile,
  handler: async (input, ctx) => {
    // Upsert on the fixed id: setup writes the first version and the admin
    // screen edits it later, through one path rather than two.
    const [profile] = await ctx.tx
      .insert(businessProfile)
      .values({ ...input, id: PROFILE_ID })
      .onConflictDoUpdate({
        target: businessProfile.id,
        set: { ...input },
      })
      .returning();
    ctx.setSubject("business_profile", String(PROFILE_ID));
    ctx.queueEvent("settings.businessUpdated", { name: profile!.name });
    return profile!;
  },
});

/**
 * Patch a subset of the profile. Separate from updateBusiness because that one
 * requires the fields a business cannot exist without; this one is for the
 * admin screen changing a tagline without restating its own country.
 */
export const patchBusiness = defineService({
  name: "settings.patchBusiness",
  summary: "Change part of the business profile.",
  kind: "mutation",
  permission: "scoped",
  input: patchProfile,
  handler: async (input, ctx) => {
    if (Object.keys(input).length === 0) {
      throw new ServiceError(
        "validation",
        "settings.patchBusiness: nothing to change",
      );
    }
    const [profile] = await ctx.tx
      .update(businessProfile)
      .set({ ...input })
      .where(eq(businessProfile.id, PROFILE_ID))
      .returning();
    if (!profile) {
      throw new ServiceError(
        "not_found",
        "No business profile yet — complete setup first.",
      );
    }
    ctx.setSubject("business_profile", String(PROFILE_ID));
    ctx.queueEvent("settings.businessUpdated", { name: profile.name });
    return profile;
  },
});

export const completeSetup = defineService({
  name: "settings.completeSetup",
  summary: "Finish first-boot setup and lock the wizard.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [profile] = await ctx.tx
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.id, PROFILE_ID))
      .limit(1);
    if (!profile) {
      throw new ServiceError(
        "not_found",
        "There is no business profile to finish. Save the business details first.",
      );
    }
    if (profile.setupCompletedAt) {
      // §13: locked after completion. Replaying the wizard against a live
      // business is how a demo instance gets reset by a passer-by.
      throw new ServiceError("conflict", "Setup is already complete.");
    }
    const [updated] = await ctx.tx
      .update(businessProfile)
      .set({ setupCompletedAt: sql`now()` })
      .where(eq(businessProfile.id, PROFILE_ID))
      .returning();
    ctx.setSubject("business_profile", String(PROFILE_ID));
    ctx.queueEvent("settings.setupCompleted", {});
    return updated!;
  },
});

/**
 * A module's own configuration (§11's `settingsSchema`, §4.8's ModuleSetting).
 *
 * Core cannot import a module, so it cannot know what a valid configuration
 * looks like — the manifest does, and the schema it declares is what validates
 * the write. That is the whole point of `settingsSchema` existing on the
 * contract: a module gets typed, validated settings without core learning
 * anything about it.
 */
export const setModuleConfig = defineService({
  name: "settings.setModuleConfig",
  summary: "Change a module's own settings.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    module: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  }),
  handler: async (input, ctx) => {
    const { default: manifests } = await import("@/modules");
    const manifest = manifests.find((m) => m.name === input.module);
    if (!manifest) {
      throw new ServiceError("not_found", `There is no module called "${input.module}".`);
    }

    let config = input.config;
    if (manifest.settingsSchema) {
      const parsed = manifest.settingsSchema.safeParse(input.config);
      if (!parsed.success) {
        throw new ServiceError(
          "validation",
          parsed.error.issues[0]?.message ?? "Those settings are not valid.",
        );
      }
      config = parsed.data as Record<string, unknown>;
    }

    const [row] = await ctx.tx
      .insert(moduleSettings)
      .values({ module: input.module, config })
      .onConflictDoUpdate({ target: moduleSettings.module, set: { config } })
      .returning();
    ctx.setSubject("module_settings", input.module);
    ctx.queueEvent("module.configured", { module: input.module });
    return row!;
  },
});

/**
 * A module's configuration, with its schema's defaults applied.
 *
 * Public because a module's own services read it while serving anonymous
 * visitors — analytics decides whether to count a request before anyone has
 * signed in. It returns configuration, never credentials: anything secret
 * belongs in the environment (§17), not in a jsonb column.
 */
export const getModuleConfig = defineService({
  name: "settings.getModuleConfig",
  summary: "Read a module's own settings.",
  kind: "query",
  permission: "public",
  input: z.object({ module: z.string().min(1) }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select({ config: moduleSettings.config })
      .from(moduleSettings)
      .where(eq(moduleSettings.module, input.module))
      .limit(1);

    const stored = (row?.config ?? {}) as Record<string, unknown>;
    const { default: manifests } = await import("@/modules");
    const manifest = manifests.find((m) => m.name === input.module);
    if (!manifest?.settingsSchema) return stored;

    // Parsed on the way out as well as in, so a module that adds a setting
    // gets its default on instances configured before it existed.
    const parsed = manifest.settingsSchema.safeParse(stored);
    return parsed.success ? (parsed.data as Record<string, unknown>) : stored;
  },
});

export const listModules = defineService({
  name: "settings.listModules",
  summary: "Module toggles that have been set.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  // Only modules with a stored row. The set of *installed* modules comes from
  // the boot report; the admin screen merges the two so a module that has
  // never been toggled still appears, at its manifest default.
  handler: async (_input, ctx) =>
    ctx.tx.select().from(moduleSettings).orderBy(moduleSettings.module),
});

export const setModuleEnabled = defineService({
  name: "settings.setModuleEnabled",
  summary: "Turn a module on or off.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ module: z.string().min(1), enabled: z.boolean() }),
  handler: async (input, ctx) => {
    if (input.module === "core") {
      // §3: core is always on. Allowing this would let an owner switch off
      // auth and lock themselves out of their own instance permanently.
      throw new ServiceError(
        "validation",
        "Core is always on and cannot be turned off.",
      );
    }
    const [row] = await ctx.tx
      .insert(moduleSettings)
      .values({ module: input.module, enabled: input.enabled })
      .onConflictDoUpdate({
        target: moduleSettings.module,
        set: { enabled: input.enabled },
      })
      .returning();
    ctx.setSubject("module_settings", input.module);
    ctx.queueEvent(
      input.enabled ? "module.enabled" : "module.disabled",
      { module: input.module },
    );
    return row!;
  },
});

export default [
  setModuleConfig,
  getModuleConfig,
  getBusiness,
  setupState,
  updateBusiness,
  patchBusiness,
  completeSetup,
  listModules,
  setModuleEnabled,
];
