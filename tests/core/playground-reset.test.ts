// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38 capacity: the hourly reset's hand-over and the heal check, run against
// a stand-in `docker` so every ordering decision is exercised without a host.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const A = "freeholder-playground";
const B = "freeholder-playground-b";

// State lives in files: <project>.up (running), .proxy (holds the alias),
// .health (Docker's health status for its app).
const FAKE_DOCKER = `#!/bin/sh
echo "docker $*" >> "$SIM/log"
if [ "$1" = compose ]; then
  project=$3; shift 5
  case "$1" in
    ps) [ -f "$SIM/$project.up" ] && echo "id-$project"; exit 0 ;;
    down) rm -f "$SIM/$project.up" "$SIM/$project.proxy"; exit 0 ;;
    up) touch "$SIM/$project.up"; exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  project=$(echo "$4" | sed 's/^id-//')
  case "$3" in
    *Networks*) [ -f "$SIM/$project.proxy" ] && echo yes; exit 0 ;;
    *Health*) cat "$SIM/$project.health" 2>/dev/null; exit 0 ;;
  esac
fi
if [ "$1" = exec ]; then [ -n "\${FAIL_READY:-}" ] && exit 1; exit 0; fi
if [ "$1" = network ] && [ "$2" = connect ]; then
  [ -n "\${FAIL_CONNECT:-}" ] && exit 1
  touch "$SIM/$(echo "$6" | sed 's/^id-//').proxy"; exit 0
fi
exit 0
`;

interface Run { status: number; log: string[]; running: string[]; serving: string[] }

function reset(state: { up?: string[]; proxy?: string[]; health?: Record<string, string> }, env: Record<string, string> = {}, args: string[] = []): Run {
  const dir = mkdtempSync(join(tmpdir(), "playground-reset-"));
  const sim = join(dir, "state");
  execFileSync("mkdir", ["-p", sim]);
  writeFileSync(join(dir, "docker"), FAKE_DOCKER);
  chmodSync(join(dir, "docker"), 0o755);
  const script = readFileSync("deploy/docker-selfhost/playground/reset.sh", "utf8")
    .replace("/run/lock/", `${dir}/`)
    .replace("cd /opt/freeholder-playground", `cd ${dir}`)
    .replace("sleep 3", "true");
  writeFileSync(join(dir, "reset.sh"), script);
  for (const project of state.up ?? []) writeFileSync(join(sim, `${project}.up`), "");
  for (const project of state.proxy ?? []) writeFileSync(join(sim, `${project}.proxy`), "");
  for (const [project, health] of Object.entries(state.health ?? {})) writeFileSync(join(sim, `${project}.health`), health);
  let status = 0;
  try {
    execFileSync("sh", [join(dir, "reset.sh"), ...args], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SIM: sim, ...env },
      stdio: "pipe",
    });
  } catch (error) {
    status = (error as { status: number }).status;
  }
  const log = existsSync(join(sim, "log"))
    ? readFileSync(join(sim, "log"), "utf8").trim().split("\n")
      .filter((line) => line && !line.includes(" ps -q app") && !line.startsWith("docker inspect"))
      .map((line) => line.replace(/node -e .*/, "node -e <ready>").replace(/--project-name | --file compose.yml/g, ""))
    : [];
  const files = readdirSync(sim);
  return {
    status,
    log,
    running: files.filter((f) => f.endsWith(".up")).map((f) => f.slice(0, -3)).sort(),
    serving: files.filter((f) => f.endsWith(".proxy")).map((f) => f.slice(0, -6)).sort(),
  };
}

const ROOM = { PLAYGROUND_OVERLAP_MIN_MB: "0" };

describe("playground reset hand-over", () => {
  it("boots the standby beside the serving stack and moves the alias only once it is ready", () => {
    const run = reset({ up: [A], proxy: [A] }, ROOM);
    expect(run.status).toBe(0);
    expect(run.log).toEqual([
      `docker compose ${B} down --timeout 5`,
      `docker compose ${B} up -d`,
      `docker exec id-${B} node -e <ready>`,
      `docker network connect --alias playground-app freeholder-playground-proxy id-${B}`,
      `docker compose ${A} down --timeout 5`,
    ]);
    expect(run).toMatchObject({ running: [B], serving: [B] });
  });

  it("picks the old stack by who holds the alias, not by which one happens to run", () => {
    // B is a leftover from a failed run; A serves. B must be replaced, A kept until hand-over.
    const run = reset({ up: [A, B], proxy: [A] }, ROOM);
    expect(run.log[0]).toBe(`docker compose ${B} down --timeout 5`);
    expect(run).toMatchObject({ status: 0, running: [B], serving: [B] });
  });

  it("stops the serving stack first when the host lacks room for two", () => {
    const run = reset({ up: [B], proxy: [B] }, { PLAYGROUND_OVERLAP_MIN_MB: "999999999" });
    expect(run.log.slice(0, 2)).toEqual([
      `docker compose ${B} down --timeout 5`,
      `docker compose ${A} down --timeout 5`,
    ]);
    expect(run).toMatchObject({ status: 0, running: [A], serving: [A] });
  });

  it("defaults the overlap threshold to the second stack plus a production reserve", () => {
    expect(readFileSync("deploy/docker-selfhost/playground/reset.sh", "utf8")).toMatch(/PLAYGROUND_OVERLAP_MIN_MB:-2200/);
  });

  for (const [why, env] of [["never becomes ready", { FAIL_READY: "1" }], ["cannot join the proxy network", { FAIL_CONNECT: "1" }]] as const) {
    it(`removes the standby and leaves the serving stack alone when it ${why}`, () => {
      const run = reset({ up: [A], proxy: [A] }, { ...ROOM, ...env });
      expect(run.status).not.toBe(0);
      expect(run.log).not.toContain(`docker compose ${A} down --timeout 5`);
      expect(run).toMatchObject({ running: [A], serving: [A] });
    });
  }
});

describe("playground heal check", () => {
  it("does nothing while the serving app is healthy or still starting", () => {
    for (const health of ["healthy", "starting"]) {
      const run = reset({ up: [A], proxy: [A], health: { [A]: health } }, ROOM, ["--heal"]);
      expect(run).toMatchObject({ status: 0, log: [], running: [A], serving: [A] });
    }
  });

  it("rebuilds when the app is unhealthy — e.g. its tmpfs database restarted empty", () => {
    const run = reset({ up: [A], proxy: [A], health: { [A]: "unhealthy" } }, ROOM, ["--heal"]);
    expect(run).toMatchObject({ status: 0, running: [B], serving: [B] });
  });

  it("rebuilds when nothing is serving at all", () => {
    const run = reset({}, ROOM, ["--heal"]);
    expect(run).toMatchObject({ status: 0, running: [A], serving: [A] });
  });
});
