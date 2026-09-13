// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder-app init` (C10.15). Network is injected: a command that only
// works against a live demo is a command CI cannot prove.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  EXIT,
  InitError,
  MAX_LOGO_BYTES,
  brandedExpoConfig,
  brandingFrom,
  bundleId,
  decodePng,
  encodePng,
  expoSlug,
  initApp,
  logoFetchUrl,
  parseArgs,
  pngSize,
  run,
  storeCopy,
  ICON_SIZE,
  SCREENSHOT,
  SPLASH,
} from "../../packages/freeholder-app/src/index";
import { instanceLogoUrl } from "@/core/discovery";
import { colors as bench } from "@/core/design/tokens";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "freeholder-app-init-"));
  dirs.push(dir);
  return dir;
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    freeholder: true,
    contractVersion: 1,
    platformVersion: "0.1.0",
    name: "Aurora Coast Photography",
    tagline: "Coastal light, honestly made",
    locales: { default: "en", enabled: ["en"] },
    currency: "CAD",
    timezone: "America/Vancouver",
    country: "CA",
    branding: {
      logoUrl: "https://aurora.example/media/2026/09/logo.png",
      colors: {
        light: {
          surface: "#fafaf8",
          paper: "#fafaf8",
          ink: "#23262a",
          accent: "#2551e0",
          onAccent: "#ffffff",
        },
      },
      fontSans: null,
    },
    ...overrides,
  };
}

function fetching(
  map: Record<
    string,
    {
      status?: number;
      json?: unknown;
      body?: Uint8Array;
      headers?: Record<string, string>;
      jsonError?: boolean;
      onArrayBuffer?: () => void;
    }
  >,
) {
  return async (url: string) => {
    const hit = map[url];
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    const body = hit.body ?? new Uint8Array();
    return {
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      url,
      headers: {
        get: (name: string) => hit.headers?.[name.toLowerCase()] ?? null,
      },
      json: async () => {
        if (hit.jsonError) throw new SyntaxError("not json");
        return hit.json;
      },
      arrayBuffer: async () => {
        hit.onArrayBuffer?.();
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      },
    };
  };
}

function logoPng(color: readonly [number, number, number] = [255, 0, 0]): Uint8Array {
  return encodePng(16, 16, () => [color[0], color[1], color[2], 255]);
}

describe("freeholder-app init (C10.15)", () => {
  describe("argument parsing", () => {
    it("reads the instance from a positional, a flag, or the environment", () => {
      expect(parseArgs(["init", "https://aurora.example/"]).options.url).toBe("https://aurora.example");
      expect(parseArgs(["init", "--url", "https://aurora.example"]).options.url).toBe(
        "https://aurora.example",
      );
      expect(parseArgs(["https://aurora.example"]).command).toBe("init");
      expect(parseArgs(["https://aurora.example"]).options.url).toBe("https://aurora.example");
      const previous = process.env.FREEHOLDER_URL;
      process.env.FREEHOLDER_URL = "https://from-env.example";
      try {
        expect(parseArgs(["init"]).options.url).toBe("https://from-env.example");
        expect(parseArgs(["init", "--url", "--json"]).options.url).toBe("");
      } finally {
        if (previous === undefined) delete process.env.FREEHOLDER_URL;
        else process.env.FREEHOLDER_URL = previous;
      }
    });

    it("does not swallow the next flag as a missing value", () => {
      const parsed = parseArgs(["init", "--url", "--json"]);
      expect(parsed.options.url).toBe("");
      expect(parsed.options.json).toBe(true);
    });
  });

  it("pulls branding, writes icons/splash/metadata/screenshots, and emits a config diff", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "app.json"),
      `${JSON.stringify({ expo: { name: "Freeholder", slug: "freeholder-customer", scheme: "freeholder" } }, null, 2)}\n`,
    );
    const logo = logoPng([0, 128, 64]);
    const result = await initApp(
      { url: "https://aurora.example", dir, json: false },
      fetching({
        "https://aurora.example/.well-known/freeholder": { json: document() },
        "https://aurora.example/media/2026/09/logo.png": { body: logo },
      }),
    );

    expect(result.instance.name).toBe("Aurora Coast Photography");
    expect(result.filesWritten).toEqual(
      expect.arrayContaining([
        "assets/icon.png",
        "assets/adaptive-icon.png",
        "assets/splash.png",
        "store/metadata.json",
        "store/screenshots/01-home.png",
        "store/screenshots/02-catalog.png",
        "store/screenshots/03-bookings.png",
        "app.json",
        "eas.json",
      ]),
    );
    expect(result.diff.find((file) => file.file === "app.json")?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "change", path: "expo.name", from: "Freeholder", to: "Aurora Coast Photography" }),
        expect.objectContaining({ op: "add", path: "expo.icon", to: "./assets/icon.png" }),
        expect.objectContaining({ op: "add", path: "expo.extra.instanceUrl", to: "https://aurora.example" }),
      ]),
    );
    expect(result.diff.find((file) => file.file === "eas.json")?.created).toBe(true);
    expect(result.notes.join(" ")).toMatch(/composite the instance logo/i);

    const iconBytes = await readFile(join(dir, "assets/icon.png"));
    const icon = pngSize(iconBytes);
    expect(icon).toEqual({ width: ICON_SIZE, height: ICON_SIZE });
    const pixels = decodePng(iconBytes);
    const center = ((ICON_SIZE / 2) * ICON_SIZE + ICON_SIZE / 2) * 4;
    expect([...pixels!.rgba.slice(center, center + 3)]).toEqual([0, 128, 64]);
    const splash = pngSize(await readFile(join(dir, "assets/splash.png")));
    expect(splash).toEqual({ width: SPLASH.width, height: SPLASH.height });
    const shot = pngSize(await readFile(join(dir, "store/screenshots/01-home.png")));
    expect(shot).toEqual({ width: SCREENSHOT.width, height: SCREENSHOT.height });

    const app = JSON.parse(await readFile(join(dir, "app.json"), "utf8")) as {
      expo: { name: string; icon: string; splash: { backgroundColor: string }; extra: { instanceUrl: string } };
    };
    expect(app.expo.name).toBe("Aurora Coast Photography");
    expect(app.expo.icon).toBe("./assets/icon.png");
    expect(app.expo.splash.backgroundColor).toBe("#fafaf8");
    expect(app.expo.extra.instanceUrl).toBe("https://aurora.example");

    const eas = JSON.parse(await readFile(join(dir, "eas.json"), "utf8")) as { cli: { appVersionSource: string } };
    expect(eas.cli.appVersionSource).toBe("local");
    expect(JSON.stringify(eas)).not.toMatch(/appleId|ascAppId|serviceAccount|EXPO_TOKEN|password/i);

    const metadata = JSON.parse(await readFile(join(dir, "store/metadata.json"), "utf8")) as {
      ios: { description: string; subtitle: string };
    };
    expect(metadata.ios.subtitle).toBe("Coastal light, honestly made");
    expect(metadata.ios.description).toContain("Aurora Coast Photography");
  });

  it("falls back to brand-colour icons when the logo is not a PNG", async () => {
    const dir = await scratch();
    const result = await initApp(
      { url: "https://aurora.example", dir, json: false },
      fetching({
        "https://aurora.example/.well-known/freeholder": { json: document() },
        "https://aurora.example/media/2026/09/logo.png": { body: new Uint8Array([0xff, 0xd8, 0xff]) },
      }),
    );
    expect(result.notes.join(" ")).toMatch(/not a PNG/i);
    expect(result.filesWritten).not.toContain("assets/logo-source.bin");
    expect(pngSize(await readFile(join(dir, "assets/icon.png")))).toEqual({
      width: ICON_SIZE,
      height: ICON_SIZE,
    });
  });

  it("still writes screenshots when discovery has no logo at all", async () => {
    const dir = await scratch();
    const result = await initApp(
      { url: "https://aurora.example", dir, json: false },
      fetching({
        "https://aurora.example/.well-known/freeholder": {
          json: document({ branding: { logoUrl: null, colors: { accent: "#116644", surface: "#ffffff" } } }),
        },
      }),
    );
    expect(result.filesWritten.filter((file) => file.startsWith("store/screenshots/"))).toHaveLength(3);
    const app = JSON.parse(await readFile(join(dir, "app.json"), "utf8")) as {
      expo: { splash: { backgroundColor: string } };
    };
    expect(app.expo.splash.backgroundColor).toBe("#ffffff");
  });

  it("does not clobber EAS credentials already in eas.json", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "eas.json"),
      `${JSON.stringify({ submit: { production: { ios: { appleId: "owner@example.com" } } } }, null, 2)}\n`,
    );
    const result = await initApp(
      { url: "https://aurora.example", dir, json: false },
      fetching({
        "https://aurora.example/.well-known/freeholder": {
          json: document({ branding: { logoUrl: null, colors: {} } }),
        },
      }),
    );
    const eas = JSON.parse(await readFile(join(dir, "eas.json"), "utf8")) as {
      submit: { production: { ios: { appleId: string } } };
      build: { production: object };
    };
    expect(eas.submit.production.ios.appleId).toBe("owner@example.com");
    expect(eas.build.production).toEqual({});
    expect(result.diff.find((file) => file.file === "eas.json")?.created).toBe(false);
  });

  it("refuses an unfinished or non-Freeholder address without writing", async () => {
    const dir = await scratch();
    const unfinished = await initApp(
      { url: "https://aurora.example", dir, json: false },
      fetching({
        "https://aurora.example/.well-known/freeholder": {
          status: 503,
          json: { freeholder: true, setupComplete: false },
        },
      }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(unfinished).toBeInstanceOf(InitError);
    expect((unfinished as InitError).code).toBe(EXIT.refused);
    expect((unfinished as InitError).message).toMatch(/not finished/i);

    const logs: string[] = [];
    const code = await run(
      ["init", "--url", "https://not-freeholder.example", "--dir", dir],
      { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) },
      fetching({ "https://not-freeholder.example/.well-known/freeholder": { json: { hello: "world" } } }),
    );
    expect(code).toBe(EXIT.refused);
    expect(logs.join("\n")).toMatch(/does not look like a Freeholder site/);
  });

  it("exits 3 when the instance cannot be reached", async () => {
    const dir = await scratch();
    const code = await run(
      ["init", "--url", "https://down.example", "--dir", dir],
      { log: () => undefined, error: () => undefined },
      async () => {
        throw new Error("fetch failed");
      },
    );
    expect(code).toBe(EXIT.unreachable);
  });

  it("insists on https except for loopback", async () => {
    const dir = await scratch();
    const code = await run(
      ["init", "--url", "http://example.com", "--dir", dir],
      { log: () => undefined, error: () => undefined },
      fetching({}),
    );
    expect(code).toBe(EXIT.usage);
  });

  it("prints JSON when asked, including the auditable diff", async () => {
    const dir = await scratch();
    const lines: string[] = [];
    const code = await run(
      ["init", "--url", "https://aurora.example", "--dir", dir, "--json"],
      { log: (msg) => lines.push(msg), error: (msg) => lines.push(msg) },
      fetching({
        "https://aurora.example/.well-known/freeholder": {
          json: document({ branding: { logoUrl: null, colors: { accent: "#2551e0" } } }),
        },
      }),
    );
    expect(code).toBe(EXIT.ok);
    const payload = JSON.parse(lines.join("\n")) as { diff: unknown; instance: { name: string } };
    expect(payload.instance.name).toBe("Aurora Coast Photography");
    expect(payload.diff).toEqual(expect.any(Array));
  });

  it("keeps store copy inside Apple/Google field limits", () => {
    const copy = storeCopy({
      url: "https://x.example",
      name: "A very long photography studio name that exceeds thirty",
      tagline: "A tagline that is definitely longer than thirty characters on purpose",
      colors: { surface: "#fff", ink: "#000", accent: "#00f", onAccent: "#fff" },
      rgb: { surface: [255, 255, 255], ink: [0, 0, 0], accent: [0, 0, 255], onAccent: [255, 255, 255] },
      logoUrl: null,
      locales: { default: "en", enabled: ["en"] },
      country: "CA",
    });
    expect(copy.name.length).toBeLessThanOrEqual(30);
    expect(copy.subtitle.length).toBeLessThanOrEqual(30);
    expect(copy.shortDescription.length).toBeLessThanOrEqual(80);
  });

  it("derives a legal bundle id and Expo slug from the business name", () => {
    expect(expoSlug("Aurora Coast Photography")).toBe("aurora-coast-photography");
    expect(bundleId("Aurora Coast Photography")).toBe("ai.freeholder.auroracoastphotography");
    expect(bundleId("42 Studio")).toMatch(/^ai\.freeholder\.[a-z]/);
  });

  it("round-trips a PNG it encoded, which is how a logo becomes an icon", () => {
    const encoded = encodePng(4, 2, (x, y) => [x * 10, y * 20, 30, 255]);
    const decoded = decodePng(encoded);
    expect(decoded?.width).toBe(4);
    expect(decoded?.height).toBe(2);
    expect([...decoded!.rgba.slice(0, 4)]).toEqual([0, 0, 30, 255]);
  });

  it("preserves existing store identity on a re-run", () => {
    const next = brandedExpoConfig(
      {
        expo: {
          slug: "already-listed",
          ios: { bundleIdentifier: "com.studio.listed" },
          android: { package: "com.studio.listed" },
          scheme: "freeholder",
        },
      },
      {
        url: "https://aurora.example",
        name: "Aurora Coast Photography",
        tagline: null,
        colors: { surface: "#ffffff", ink: "#000000", accent: "#2551e0", onAccent: "#ffffff" },
        rgb: { surface: [255, 255, 255], ink: [0, 0, 0], accent: [37, 81, 224], onAccent: [255, 255, 255] },
        logoUrl: null,
        locales: { default: "en", enabled: ["en"] },
        country: "CA",
      },
    ) as {
      expo: { slug: string; ios: { bundleIdentifier: string }; android: { package: string }; name: string };
    };
    expect(next.expo.name).toBe("Aurora Coast Photography");
    expect(next.expo.slug).toBe("already-listed");
    expect(next.expo.ios.bundleIdentifier).toBe("com.studio.listed");
    expect(next.expo.android.package).toBe("com.studio.listed");
  });

  it("reads Bench's nested light/dark theme the way discovery actually ships it", () => {
    const brand = brandingFrom("https://aurora.example", {
      name: "Aurora Coast",
      branding: { colors: bench, logoUrl: null },
    });
    expect(brand.colors.accent).toBe(bench.light.accent);
    expect(brand.colors.surface).toBe(bench.light.surface);
    expect(brand.colors.ink).toBe(bench.light.ink);
  });

  it("treats reachable non-JSON as not a Freeholder site, not unreachable", async () => {
    const dir = await scratch();
    const code = await run(
      ["init", "--url", "https://html.example", "--dir", dir],
      { log: () => undefined, error: () => undefined },
      fetching({
        "https://html.example/.well-known/freeholder": { status: 200, jsonError: true },
      }),
    );
    expect(code).toBe(EXIT.refused);
  });

  it("does not fetch a logo off the instance origin or past the size cap", async () => {
    expect(logoFetchUrl("https://evil.example/logo.png", "https://aurora.example")).toBeNull();
    expect(logoFetchUrl("https://aurora.example/media/2026/09/logo.png", "https://aurora.example")?.toString()).toBe(
      "https://aurora.example/media/2026/09/logo.png",
    );

    const dir = await scratch();
    let buffered = false;
    const result = await initApp(
      { url: "https://aurora.example", dir, json: false },
      fetching({
        "https://aurora.example/.well-known/freeholder": {
          json: document({
            branding: { logoUrl: "https://aurora.example/media/huge.png", colors: { accent: "#2551e0" } },
          }),
        },
        "https://aurora.example/media/huge.png": {
          headers: { "content-length": String(MAX_LOGO_BYTES + 1) },
          body: new Uint8Array([1, 2, 3]),
          onArrayBuffer: () => {
            buffered = true;
          },
        },
      }),
    );
    expect(buffered).toBe(false);
    expect(result.notes.join(" ")).toMatch(/1 MiB/i);
  });

  it("rewrites adapter image URLs onto the instance media route", () => {
    expect(instanceLogoUrl("https://aurora.example", "/media/2026/09/logo.png")).toBe(
      "https://aurora.example/media/2026/09/logo.png",
    );
    expect(instanceLogoUrl("https://aurora.example", "https://cdn.example/2026/09/logo.png")).toBe(
      "https://aurora.example/media/2026/09/logo.png",
    );
    expect(instanceLogoUrl("https://aurora.example", "/media/download/not-an-image")).toBeNull();
    expect(instanceLogoUrl("https://aurora.example", "/elsewhere/logo.png")).toBeNull();
  });

  it("preserves the existing Expo scheme so deep links keep working", () => {
    const next = brandedExpoConfig(
      { expo: { scheme: "freeholder", plugins: ["expo-router"] } },
      {
        url: "https://aurora.example",
        name: "Aurora Coast Photography",
        tagline: null,
        colors: { surface: "#ffffff", ink: "#000000", accent: "#2551e0", onAccent: "#ffffff" },
        rgb: { surface: [255, 255, 255], ink: [0, 0, 0], accent: [37, 81, 224], onAccent: [255, 255, 255] },
        logoUrl: null,
        locales: { default: "en", enabled: ["en"] },
        country: "CA",
      },
    ) as { expo: { scheme: string; plugins: string[] } };
    expect(next.expo.scheme).toBe("freeholder");
    expect(next.expo.plugins).toEqual(["expo-router"]);
  });

  describe("packaging", () => {
    const manifest = JSON.parse(readFileSync("packages/freeholder-app/package.json", "utf8")) as {
      bin: Record<string, string>;
      license: string;
      name: string;
    };

    it("installs as the `freeholder-app` binary so npx freeholder-app init works", () => {
      expect(manifest.name).toBe("freeholder-app");
      expect(manifest.bin["freeholder-app"]).toBe("./dist/index.js");
      expect(manifest.license).toBe("Apache-2.0");
    });

    it("is built and linted with the other published packages", () => {
      const root = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
      expect(root.scripts["packages:build"]).toContain("freeholder-app");
      expect(root.scripts["packages:lint"]).toContain("freeholder-app");
    });

    it("is a client of discovery, never a second branding implementation and never EAS login", () => {
      const source = [
        readFileSync("packages/freeholder-app/src/index.ts", "utf8"),
        readFileSync("packages/freeholder-app/src/init.ts", "utf8"),
      ].join("\n");
      expect(source).toContain("/.well-known/freeholder");
      expect(source).not.toContain("child_process");
      expect(source).not.toContain("eas-cli");
      expect(source).not.toContain("EXPO_TOKEN");
    });
  });
});
