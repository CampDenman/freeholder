// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder launch` flags. Secrets may come from the environment instead of
// the command line, so they stay out of shell history and process lists.
import { defaultName } from "./launch.js";
import type { LaunchOptions } from "./types.js";

export function parseLaunchArgs(argv: readonly string[], env: Record<string, string | undefined> = process.env): LaunchOptions {
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    const found = index >= 0 ? argv[index + 1] : undefined;
    return found && !found.startsWith("--") ? found : undefined;
  };
  const flag = (name: string) => argv.includes(`--${name}`);
  const domain = (value("domain") ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    provider: value("provider") ?? "digitalocean",
    domain,
    name: value("name") ?? defaultName(domain),
    region: value("region") ?? "nyc3",
    size: value("size") ?? "s-2vcpu-2gb",
    sshKey: value("ssh-key"),
    sshIdentity: value("ssh-identity"),
    temporaryHost: flag("temporary-host"),
    image: value("image"),
    paradisemodernKey: value("paradisemodern-key") ?? env.PARADISEMODERN_API_KEY,
    paradisemodernSiteId: value("paradisemodern-site-id") ?? env.PARADISEMODERN_SITE_ID,
    nonInteractive: flag("non-interactive"),
    json: flag("json"),
    dryRun: flag("dry-run"),
    open: !flag("no-open"),
    cutover: flag("cutover"),
    destroy: flag("destroy"),
    confirm: value("confirm"),
    context: value("context"),
  };
}
