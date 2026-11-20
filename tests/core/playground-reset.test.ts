// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38 capacity: the hourly reset's hand-over and the heal check, run against
// a stand-in `docker` so every ordering decision is exercised without a host.
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeSchema } from "@/core/runtime/schema-probe";

const A = "freeholder-playground";
const B = "freeholder-playground-b";
const REPO = "ghcr.io/campdenman/freeholder";
const targetDigest = `sha256:${"a".repeat(64)}`;
const targetPin = `${REPO}@${targetDigest}`;
const priorPin = `${REPO}@sha256:${"b".repeat(64)}`;
const targetId = `sha256:${"c".repeat(64)}`;
const priorId = `sha256:${"d".repeat(64)}`;
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

// .proxy records aliases on the proxy network, .image records Docker image
// metadata, and .probe is the schema probe result ("ok" when absent).
const FAKE_DOCKER = `#!/bin/sh
echo "docker $*" >> "$SIM/log"
if [ "$1" = pull ]; then
  [ "$2" = '${REPO}:edge' ] || exit 1
  echo 'Digest: ${targetDigest}'
  exit 0
fi
if [ "$1" = image ]; then
  [ "$5" = '${targetPin}' ] || exit 1
  echo '${targetId}'
  exit 0
fi
if [ "$1" = compose ]; then
  project=$3; shift 5
  case "$1" in
    ps) [ -f "$SIM/$project.up" ] && echo "id-$project"; exit 0 ;;
    down)
      if [ "\${STALE_HANDOVER:-}" = 1 ] && [ "$project" = '${B}' ]; then exit 0; fi
      rm -f "$SIM/$project.up" "$SIM/$project.proxy" "$SIM/$project.probe" "$SIM/$project.image"; exit 0 ;;
    up)
      touch "$SIM/$project.up"
      pin=\${FREEHOLDER_IMAGE:-$(sed -n 's/^FREEHOLDER_IMAGE=//p' .env)}
      id='${priorId}'
      if [ "$pin" = '${targetPin}' ] && [ "\${STALE_IMAGE_ID:-}" != 1 ]; then id='${targetId}'; fi
      printf '%s %s\\n' "$pin" "$id" > "$SIM/$project.image"
      exit 0 ;;
  esac
fi
if [ "$1" = inspect ]; then
  project=$(echo "$4" | sed 's/^id-//')
  case "$3" in
    *Config.Image*) cat "$SIM/$project.image"; exit $? ;;
    *) [ ! -f "$SIM/$project.proxy" ] || cat "$SIM/$project.proxy" ;;
  esac
  exit 0
fi
if [ "$1" = exec ]; then
  project=$(echo "$2" | sed 's/^id-//')
  case "$*" in
    *health/db*) cat "$SIM/$project.probe" 2>/dev/null || echo ok; exit 0 ;;
  esac
  [ -n "\${FAIL_READY:-}" ] && exit 1
  exit 0
fi
if [ "$1" = network ] && [ "$2" = inspect ]; then
  for path in "$SIM/"*.proxy; do
    [ -f "$path" ] || continue
    name=\${path##*/}
    echo "id-\${name%.proxy}"
  done
  exit 0
fi
if [ "$1" = network ] && [ "$2" = connect ]; then
  [ -n "\${FAIL_CONNECT:-}" ] && exit 1
  [ "\${STALE_HANDOVER:-}" = 1 ] && exit 0
  printf '%s\\n' "$4" > "$SIM/$(echo "$6" | sed 's/^id-//').proxy"
fi
exit 0
`;

const FAKE_CURL = `#!/bin/sh
echo "curl $*" >> "$SIM/log"
if [ "\${CHANGE_ALIAS_ON_HEALTH:-}" = 1 ]; then
  rm -f "$SIM/${B}.proxy"
  echo playground-app > "$SIM/${A}.proxy"
fi
printf '%s' "\${HTTP_CODE:-200}"
`;

interface Run { status: number; log: string[]; running: string[]; serving: string[]; stdout: string; stderr: string }

/** A pretend host whose state persists across reset.sh runs. */
function host(state: {
  up?: string[];
  proxy?: string[];
  probe?: Record<string, string>;
  otherAliases?: string[];
  pin?: string;
  images?: Record<string, string>;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "playground-reset-"));
  fixtureDirs.push(dir);
  const sim = join(dir, "state");
  mkdirSync(sim);
  writeFileSync(join(dir, "docker"), FAKE_DOCKER);
  chmodSync(join(dir, "docker"), 0o755);
  writeFileSync(join(dir, "curl"), FAKE_CURL, { mode: 0o755 });
  const envFile = join(dir, ".env");
  writeFileSync(envFile, `PLAYGROUND_DOMAIN=demo.example.test\nFREEHOLDER_IMAGE=${state.pin ?? priorPin}\n`, { mode: 0o600 });
  const script = readFileSync("deploy/docker-selfhost/playground/reset.sh", "utf8")
    .replaceAll("/run/lock/", `${dir}/`)
    .replace("PLAYGROUND_PATH=/opt/freeholder-playground", `PLAYGROUND_PATH=${dir}`)
    .replace("sleep 3", "true")
    .replace("sleep 10", "true");
  writeFileSync(join(dir, "reset.sh"), script);
  for (const project of state.up ?? []) {
    writeFileSync(join(sim, `${project}.up`), "");
    const image = state.images?.[project] ?? priorPin;
    writeFileSync(join(sim, `${project}.image`), `${image} ${image === targetPin ? targetId : priorId}\n`);
  }
  for (const project of state.proxy ?? []) writeFileSync(join(sim, `${project}.proxy`), "playground-app\n");
  for (const project of state.otherAliases ?? []) writeFileSync(join(sim, `${project}.proxy`), "other-playground-app\n");
  for (const [project, probe] of Object.entries(state.probe ?? {})) writeFileSync(join(sim, `${project}.probe`), probe);

  return Object.assign(run, { dir, envFile, image: (project: string) => readFileSync(join(sim, `${project}.image`), "utf8").trim() });

  function run(env: Record<string, string> = {}, args: string[] = []): Run {
    writeFileSync(join(sim, "log"), "");
    let status = 0;
    let stdout = "";
    let stderr = "";
    try {
      const streaming = args.includes("--update-image");
      stdout = execFileSync("sh", streaming ? ["-s", "--", ...args] : [join(dir, "reset.sh"), ...args], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SIM: sim, ...env },
        encoding: "utf8",
        stdio: "pipe",
        input: streaming ? script : undefined,
      });
    } catch (error) {
      ({ status, stdout, stderr } = error as { status: number; stdout: string; stderr: string });
    }
    const log = readFileSync(join(sim, "log"), "utf8").trim().split("\n")
      .filter((line) => line && !line.includes(" ps -q app") && !line.startsWith("docker inspect") &&
        !line.startsWith("docker network inspect") && !line.includes("health/db"))
      .map((line) => line.replace(/node -e .*/, "node -e <ready>").replace(/--project-name | --file compose.yml/g, ""));
    const files = readdirSync(sim);
    return {
      status,
      log,
      stdout,
      stderr,
      running: files.filter((f) => f.endsWith(".up")).map((f) => f.slice(0, -3)).sort(),
      serving: files.filter((f) => f.endsWith(".proxy") && readFileSync(join(sim, f), "utf8").trim() === "playground-app")
        .map((f) => f.slice(0, -6)).sort(),
    };
  }
}

const ROOM = { PLAYGROUND_OVERLAP_MIN_MB: "0" };
const NO_ROOM = { PLAYGROUND_OVERLAP_MIN_MB: "999999999" };
const UNCHANGED = { status: 0, log: [], running: [A], serving: [A] };

describe("playground reset hand-over", () => {
  it("boots the standby beside the serving stack and moves the alias only once it is ready", () => {
    const run = host({ up: [A], proxy: [A] })(ROOM);
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
    const run = host({ up: [A, B], proxy: [A] })(ROOM);
    expect(run.log[0]).toBe(`docker compose ${B} down --timeout 5`);
    expect(run).toMatchObject({ status: 0, running: [B], serving: [B] });
  });

  it("stops the serving stack first when the host lacks room for two", () => {
    const run = host({ up: [B], proxy: [B] })(NO_ROOM);
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
      const run = host({ up: [A], proxy: [A] })({ ...ROOM, ...env });
      expect(run.status).not.toBe(0);
      expect(run.log).not.toContain(`docker compose ${A} down --timeout 5`);
      expect(run).toMatchObject({ running: [A], serving: [A] });
    });
  }
});

describe("playground heal check", () => {
  const heal = ["--heal"];

  it("does nothing while the schema probe answers", () => {
    const run = host({ up: [A], proxy: [A] });
    expect(run(ROOM, heal)).toMatchObject(UNCHANGED);
    expect(run(ROOM, heal)).toMatchObject(UNCHANGED);
  });

  it("ignores one failed probe, and a success in between starts the count again", () => {
    const run = host({ up: [A], proxy: [A], probe: { [A]: "failing" } });
    expect(run(ROOM, heal)).toMatchObject(UNCHANGED);
    writeFileSync(join(tmpdirOf(run), "state", `${A}.probe`), "ok");
    expect(run(ROOM, heal)).toMatchObject(UNCHANGED);
    writeFileSync(join(tmpdirOf(run), "state", `${A}.probe`), "failing");
    expect(run(ROOM, heal)).toMatchObject(UNCHANGED);
  });

  it("rebuilds beside the old stack after two consecutive failures", () => {
    const run = host({ up: [A], proxy: [A], probe: { [A]: "failing" } });
    expect(run(ROOM, heal)).toMatchObject(UNCHANGED);
    expect(run(ROOM, heal)).toMatchObject({ status: 0, running: [B], serving: [B] });
  });

  it("never stops a slow but answering playground when there is no room to overlap", () => {
    const run = host({ up: [A], proxy: [A], probe: { [A]: "slow" } });
    for (let check = 0; check < 3; check += 1) expect(run(NO_ROOM, heal)).toMatchObject(UNCHANGED);
  });

  it("rebuilds an emptied database even without room, after two checks", () => {
    const run = host({ up: [A], proxy: [A], probe: { [A]: "missing" } });
    expect(run(NO_ROOM, heal)).toMatchObject(UNCHANGED);
    const rebuilt = run(NO_ROOM, heal);
    expect(rebuilt.log.slice(0, 2)).toEqual([
      `docker compose ${A} down --timeout 5`,
      `docker compose ${B} down --timeout 5`,
    ]);
    expect(rebuilt).toMatchObject({ status: 0, running: [B], serving: [B] });
  });

  it("rebuilds at once when nothing is serving at all", () => {
    expect(host()(ROOM, heal)).toMatchObject({ status: 0, running: [A], serving: [A] });
  });
});

describe("promoted playground image handover", () => {
  const update = ["--update-image"];

  it("moves the proxy from the stale alternate project and commits the proven digest", () => {
    const run = host({ up: [B], proxy: [B] });
    const updated = run(ROOM, update);
    expect(updated, updated.stderr).toMatchObject({ status: 0, running: [A], serving: [A] });
    expect(updated.stdout).toContain(`Playground now serves ${targetPin}`);
    expect(run.image(A)).toBe(`${targetPin} ${targetId}`);
    expect(readFileSync(run.envFile, "utf8")).toBe(`PLAYGROUND_DOMAIN=demo.example.test\nFREEHOLDER_IMAGE=${targetPin}\n`);
    expect(updated.log).toContain("curl -sS --max-time 15 -o /dev/null -w %{http_code} https://demo.freeholder.ai/api/health");
  });

  it("does no reset when the alternate project serves the target and another member has a similar alias", () => {
    const run = host({ up: [A, B], proxy: [B], otherAliases: [A], pin: targetPin, images: { [B]: targetPin } });
    const current = run(ROOM, update);
    expect(current, current.stderr).toMatchObject({ status: 0, running: [A, B], serving: [B] });
    expect(current.stdout).toContain(`Playground already serves ${targetPin}`);
    expect(current.log.some((line) => line.includes(" up -d") || line.includes(" down --timeout"))).toBe(false);
  });

  it("refuses success when the target pin and standby are current but the stale alternate still owns the alias", () => {
    const run = host({ up: [B], proxy: [B], pin: targetPin });
    const stale = run({ ...ROOM, HTTP_CODE: "200", STALE_HANDOVER: "1" }, update);
    expect(stale).toMatchObject({ status: 1, running: [A, B], serving: [B] });
    expect(stale.stderr).toContain("proxy alias does not serve the promoted digest");
    expect(stale.log.some((line) => line.startsWith("curl "))).toBe(false);
    expect(run.image(B)).toBe(`${priorPin} ${priorId}`);
    expect(run.image(A)).toBe(`${targetPin} ${targetId}`);
  });

  it("checks the serving digest again after a public HTTP 200", () => {
    const run = host({ up: [A, B], proxy: [B], images: { [B]: targetPin } });
    const changed = run({ ...ROOM, CHANGE_ALIAS_ON_HEALTH: "1" }, update);
    expect(changed).toMatchObject({ status: 1, running: [A, B], serving: [A] });
    expect(changed.stderr).toContain("proxy alias changed during the public readiness check");
    expect(readFileSync(run.envFile, "utf8")).toContain(`FREEHOLDER_IMAGE=${priorPin}\n`);
  });

  it("refuses duplicate proxy alias holders before touching either project", () => {
    const run = host({ up: [A, B], proxy: [A, B], images: { [A]: targetPin } });
    const ambiguous = run(ROOM, update);
    expect(ambiguous).toMatchObject({ status: 1, serving: [A, B] });
    expect(ambiguous.log.some((line) => line.startsWith("docker compose") || line.startsWith("docker pull"))).toBe(false);
    expect(ambiguous.stderr).toContain("Multiple running containers hold the playground proxy alias");
  });

  it("refuses multiple pin assignments even when the trailing one is empty", () => {
    const run = host({ up: [B], proxy: [B] });
    appendFileSync(run.envFile, "FREEHOLDER_IMAGE=\n");
    const invalid = run(ROOM, update);
    expect(invalid).toMatchObject({ status: 1, log: [], serving: [B] });
    expect(invalid.stderr).toContain("A single immutable FREEHOLDER_IMAGE pin is required");
  });

  it("rejects a matching standby pin with the wrong runtime image ID before it takes the alias", () => {
    const run = host({ up: [B], proxy: [B] });
    const stale = run({ ...ROOM, STALE_IMAGE_ID: "1" }, update);
    expect(stale).toMatchObject({ status: 1, running: [B], serving: [B] });
    expect(stale.stderr).toContain("Standby playground is running a different image");
    expect(readFileSync(run.envFile, "utf8")).toContain(`FREEHOLDER_IMAGE=${priorPin}\n`);
  });

  it("restores the prior image and retains its pin when the promoted image fails public readiness", () => {
    const run = host({ up: [B], proxy: [B] });
    const failed = run({ ...NO_ROOM, HTTP_CODE: "503" }, update);
    expect(failed).toMatchObject({ status: 1, running: [B], serving: [B] });
    expect(failed.stderr).toContain("Public playground health returned HTTP 503");
    expect(failed.stderr).toContain("Restored the previous playground image");
    expect(run.image(B)).toBe(`${priorPin} ${priorId}`);
    expect(readFileSync(run.envFile, "utf8")).toContain(`FREEHOLDER_IMAGE=${priorPin}\n`);
  });
});

describe("the schema probe behind /api/health/db", () => {
  it("separates an emptied database from a slow or failing one", async () => {
    expect(await probeSchema(async () => true)).toBe("ok");
    expect(await probeSchema(async () => false)).toBe("schema_missing");
    expect(await probeSchema(async () => { throw new Error("connection refused"); })).toBe("unavailable");
  });
});

/** The temporary host directory behind a `host()` runner. */
function tmpdirOf(run: ReturnType<typeof host>): string {
  return run.dir;
}
