// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The declarative instance description (MASTER.md §17): deployment target ×
// adapter profile × business preset. Checked in; secrets live in env only.
import { z } from "zod";
import { CONFIGURABLE_PAYMENT_PROVIDER_IDS } from "@/adapters/payments/providers";

export const configSchema = z.object({
  target: z
    .enum([
      "local",
      "replit",
      "digitalocean-app",
      "digitalocean-droplet",
      "railway",
      "render",
      "fly",
      "docker-selfhost",
    ])
    .default("local"),
  adapters: z
    .object({
      payments: z.enum(CONFIGURABLE_PAYMENT_PROVIDER_IDS).default("manual"),
      mailTransactional: z
        .enum(["gmail", "outlook", "smtp", "console"])
        .default("console"),
      mailBulk: z.enum(["resend", "postmark", "ses", "none"]).default("none"),
      storage: z.enum(["s3", "replit", "local"]).default("local"),
      calendar: z.enum(["google", "microsoft", "none"]).default("none"),
      sms: z.enum(["twilio", "none"]).default("none"),
      ai: z.enum(["anthropic", "openai", "none"]).default("none"),
      /**
       * The builder that changes this site on the owner's instruction (§37).
       * Deliberately separate from `ai`: that one grounds answers and drafts
       * translations, this one writes changes, and they carry different risk.
       *
       * pm_brain is *our* default and nothing more — whoever deploys their own
       * copy sets this to whatever intelligence they run, or to "none", which
       * removes the builder entirely. A platform that hardcodes its owner's
       * choice of model has not understood §1.
       */
      agent: z
        .enum(["pm_brain", "anthropic", "openai", "local", "none"])
        .default("none"),
      fx: z.enum(["manual", "ecb"]).default("manual"),
    })
    .prefault({}),
  preset: z
    .enum(["creator", "service-business", "shop", "everything", "custom"])
    .default("everything"),
  locales: z.array(z.string()).min(1).default(["en"]),
  baseCurrency: z.string().length(3).default("USD"),
  plugins: z
    .array(
      z.object({
        name: z.string().min(1),
        version: z.string().min(1),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
});

export type FreeholderConfig = z.infer<typeof configSchema>;
export type FreeholderConfigInput = z.input<typeof configSchema>;

export function defineConfig(input: FreeholderConfigInput): FreeholderConfig {
  return configSchema.parse(input);
}
