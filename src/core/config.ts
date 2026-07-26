// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The declarative instance description (MASTER.md §17): deployment target ×
// adapter profile × business preset. Checked in; secrets live in env only.
import { z } from "zod";

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
      payments: z.enum(["stripe", "paypal", "manual"]).default("manual"),
      mailTransactional: z
        .enum(["gmail", "outlook", "smtp", "console"])
        .default("console"),
      mailBulk: z.enum(["resend", "postmark", "ses", "none"]).default("none"),
      storage: z.enum(["s3", "replit", "local"]).default("local"),
      calendar: z.enum(["google", "microsoft", "none"]).default("none"),
      sms: z.enum(["twilio", "none"]).default("none"),
      ai: z.enum(["anthropic", "openai", "none"]).default("none"),
      fx: z.enum(["manual", "ecb"]).default("manual"),
    })
    .prefault({}),
  preset: z
    .enum(["creator", "service-business", "shop", "everything", "custom"])
    .default("everything"),
  locales: z.array(z.string()).min(1).default(["en"]),
  baseCurrency: z.string().length(3).default("USD"),
});

export type FreeholderConfig = z.infer<typeof configSchema>;
export type FreeholderConfigInput = z.input<typeof configSchema>;

export function defineConfig(input: FreeholderConfigInput): FreeholderConfig {
  return configSchema.parse(input);
}
