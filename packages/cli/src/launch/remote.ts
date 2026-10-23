// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The droplet over the system's own ssh and scp. Host keys are recorded in
// the site's own known_hosts on first contact and checked after that.
import { spawn } from "node:child_process";
import type { Remote } from "./types.js";

function exec(command: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function sshRemote(ip: string, knownHosts: string, identity?: string): Remote {
  const common = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "ConnectTimeout=15", ...(identity ? ["-i", identity] : [])];
  return {
    run: (command) => exec("ssh", [...common, `root@${ip}`, command]),
    async upload(files) {
      for (const f of files) {
        const result = await exec("scp", [...common, f.local, `root@${ip}:${f.remote}`]);
        if (result.code !== 0) throw new Error(`Could not copy ${f.local} to the server.`);
      }
    },
    async writeFile(path, content, mode) {
      // The content goes over stdin, never on a command line a process list could show.
      const result = await exec("ssh", [...common, `root@${ip}`, `umask 077 && cat > ${path}.tmp && chmod ${mode} ${path}.tmp && mv ${path}.tmp ${path}`], content);
      if (result.code !== 0) throw new Error(`Could not write ${path} on the server.`);
    },
  };
}
