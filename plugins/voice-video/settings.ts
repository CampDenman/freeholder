// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Paradise Comms provider configuration. Secrets are stored as
// ciphertext in module_settings (§41's addendum to §17: the environment key
// encrypts the database secret), and every read path that serves a screen
// returns non-secret fields only.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { moduleSettings } from "@/core/settings/schema";
import { decryptSecret, encryptSecret } from "@/core/connections/crypto";

/**
 * The settingsSchema registered on the plugin manifest (§11). Secret fields
 * hold `v1.<nonce>.<ciphertext>` envelopes, never plaintext — the schema sees
 * opaque strings on the way in and out; only `voiceVideo.configure` writes
 * them, through `sealParadiseSecrets`.
 */
export const voiceVideoSettingsSchema = z.object({
  provider: z.enum(["paradise", "daily"]).default("paradise"),
  paradise: z
    .object({
      baseUrl: z.string().url().max(300).optional(),
      authScheme: z.enum(["site_key", "portfolio_token"]).optional(),
      apiKeyCiphertext: z.string().max(4000).optional(),
      portfolioTokenCiphertext: z.string().max(4000).optional(),
      webhookSecretCiphertext: z.string().max(4000).optional(),
      roomPolicy: z.enum(["open", "moderated", "invite_only"]).optional(),
      retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
    })
    .optional(),
});

export type VoiceVideoSettings = z.infer<typeof voiceVideoSettingsSchema>;

/**
 * The stored settings row (or null when the owner never saved any). Reads
 * outside a service transaction on purpose: the provider factory runs from
 * orchestrated services and job handlers, which own no transaction to reuse.
 * `stored` matters for provider selection — an instance configured only
 * through the Daily environment variables has no row and must keep Daily.
 */
export async function readVoiceVideoSettings(): Promise<{ settings: VoiceVideoSettings; stored: boolean }> {
  const [row] = await db().select().from(moduleSettings).where(eq(moduleSettings.module, "voice-video")).limit(1);
  if (!row) return { settings: voiceVideoSettingsSchema.parse({}), stored: false };
  const parsed = voiceVideoSettingsSchema.safeParse(row.config);
  if (!parsed.success) {
    throw new Error("The stored voice-video settings are invalid. Save them again from the admin screen.");
  }
  return { settings: parsed.data, stored: true };
}

export const PARADISE_PRODUCTION_BASE_URL = "https://paradisemodern.com/v1";
export const PARADISE_STAGING_BASE_URL = "https://comms-staging.paradisemodern.com/v1";

/** Additional authenticated data binds each envelope to its field. */
const AAD = {
  apiKey: "voice-video:paradise:api-key",
  portfolioToken: "voice-video:paradise:portfolio-token",
  webhookSecret: "voice-video:paradise:webhook-secret",
} as const;

export interface ParadiseSecrets {
  apiKey?: string;
  portfolioToken?: string;
  webhookSecret?: string;
}

/** Encrypt submitted plaintext secrets; absent fields stay absent. */
export function sealParadiseSecrets(secrets: ParadiseSecrets): Record<string, string> {
  const sealed: Record<string, string> = {};
  if (secrets.apiKey !== undefined) sealed.apiKeyCiphertext = encryptSecret(secrets.apiKey, AAD.apiKey);
  if (secrets.portfolioToken !== undefined) {
    sealed.portfolioTokenCiphertext = encryptSecret(secrets.portfolioToken, AAD.portfolioToken);
  }
  if (secrets.webhookSecret !== undefined) {
    sealed.webhookSecretCiphertext = encryptSecret(secrets.webhookSecret, AAD.webhookSecret);
  }
  return sealed;
}

/** The secret half of a stored config, decrypted server-side only. */
export function openParadiseSecrets(paradise: VoiceVideoSettings["paradise"]): {
  apiKey: string | null;
  portfolioToken: string | null;
  webhookSecret: string | null;
} {
  return {
    apiKey: paradise?.apiKeyCiphertext ? decryptSecret(paradise.apiKeyCiphertext, AAD.apiKey) : null,
    portfolioToken: paradise?.portfolioTokenCiphertext
      ? decryptSecret(paradise.portfolioTokenCiphertext, AAD.portfolioToken)
      : null,
    webhookSecret: paradise?.webhookSecretCiphertext
      ? decryptSecret(paradise.webhookSecretCiphertext, AAD.webhookSecret)
      : null,
  };
}

export interface ParadiseConfig {
  baseUrl: string;
  authScheme: "site_key" | "portfolio_token";
  apiKey: string | null;
  portfolioToken: string | null;
  webhookSecret: string | null;
  roomPolicy: "open" | "moderated" | "invite_only";
  retentionDays: number | null;
}

/**
 * Defaults applied where the stored config is silent. New instances default
 * to Paradise Comms; instances configured for Daily keep their provider
 * until an owner switches them (owner decision 2026-09-27, no forced
 * migration).
 */
export function resolveParadiseConfig(settings: VoiceVideoSettings): ParadiseConfig {
  const paradise = settings.paradise ?? {};
  const baseUrl = (paradise.baseUrl ?? PARADISE_PRODUCTION_BASE_URL).trim().replace(/\/+$/, "");
  const secrets = openParadiseSecrets(paradise);
  return {
    baseUrl,
    authScheme: paradise.authScheme ?? "site_key",
    apiKey: secrets.apiKey,
    portfolioToken: secrets.portfolioToken,
    webhookSecret: secrets.webhookSecret,
    roomPolicy: paradise.roomPolicy ?? "invite_only",
    retentionDays: paradise.retentionDays ?? null,
  };
}
