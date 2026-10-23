// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The real-world wiring for `freeholder launch`: the DigitalOcean API, the
// system's ssh and scp, the browser, the terminal. Kept apart from the update
// client, which never runs local commands.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parseLaunchArgs } from "./args.js";
import { digitalOcean, digitalOceanToken } from "./digitalocean.js";
import { LAUNCH_EXIT, runLaunch } from "./launch.js";
import { sshRemote } from "./remote.js";

/** `freeholder launch`: provision a new hosted site and print its owner claim link. */
export async function launch(argv: readonly string[], out: { log: (l: string) => void; error: (l: string) => void }): Promise<number> {
  const options = parseLaunchArgs(argv);
  if (options.provider !== "digitalocean") {
    out.error(`freeholder launch: the ${options.provider} provider is not available yet. Use --provider digitalocean.`);
    return LAUNCH_EXIT.failed;
  }
  const token = await digitalOceanToken(options.context);
  if (!token) {
    out.error("freeholder launch: no DigitalOcean token. Set DIGITALOCEAN_TOKEN, or sign in with `doctl auth init`.");
    return LAUNCH_EXIT.unreachable;
  }
  const desktop = process.platform === "darwin" || process.platform === "win32" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  return runLaunch(options, {
    provider: digitalOcean(token),
    remote: sshRemote,
    canOpen: desktop && Boolean(process.stdout.isTTY),
    openUrl: (url) => {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      spawn(opener, [url], { detached: true, stdio: "ignore" }).on("error", () => undefined).unref();
    },
    prompt: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    out,
  });
}

