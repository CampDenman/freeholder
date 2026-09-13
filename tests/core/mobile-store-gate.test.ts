// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Store-readiness gate (C10.16). A gate is worth the cases it can fail:
// unparsable demo contract, a missing init asset, a privacy manifest that
// does not match the permissions the binary requests.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  APP_CONTRACT_VERSION,
  discover,
} from "../../packages/mobile-app/src/index";
import { CONTRACT_VERSION } from "@/core/discovery";
import { STORE_ASSET_PATHS, generateAssets, brandingFrom } from "../../packages/freeholder-app/src/index";
import { BUSINESS } from "../../seed/demo/content";
import {
  REQUIRED_STORE_ASSETS,
  demoDiscoveryFromSources,
  parseDiscoveryContract,
  reviewMobileStore,
  reviewPrivacyManifest,
  reviewStoreAssets,
  runMobileStoreGate,
} from "../../scripts/mobile-store-gate.mjs";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "freeholder-store-gate-"));
  dirs.push(dir);
  return dir;
}

const PRIVACY = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [] as string[],
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeName",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
    },
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID",
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
    },
  ],
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
      NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
      NSPrivacyAccessedAPITypeReasons: ["C617.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
      NSPrivacyAccessedAPITypeReasons: ["E174.1"],
    },
  ],
};

function appConfig(overrides: Record<string, unknown> = {}) {
  return {
    expo: {
      name: "Freeholder",
      plugins: ["expo-router", "expo-secure-store"],
      ios: { bundleIdentifier: "ai.freeholder.customer", privacyManifests: PRIVACY },
      android: { package: "ai.freeholder.customer" },
      ...overrides,
    },
  };
}

function appPackage() {
  return {
    dependencies: {
      "expo-secure-store": "~57.0.3",
      "expo-file-system": "~57.0.6",
    },
  };
}

function demoFiles() {
  return {
    discovery: readFileSync("src/core/discovery.ts", "utf8"),
    appDiscovery: readFileSync("packages/mobile-app/src/discovery.ts", "utf8"),
    seed: readFileSync("seed/demo/content.ts", "utf8"),
    platformVersion: "0.1.0",
  };
}

async function writeAssets(dir: string, brandName = "Freeholder"): Promise<void> {
  const generated = generateAssets(
    brandingFrom("https://demo.freeholder.example", {
      name: brandName,
      tagline: "Client app",
      branding: { colors: {} },
    }),
    null,
  );
  for (const [relative, contents] of Object.entries(generated.files)) {
    const path = join(dir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

describe("mobile store gate (C10.16)", () => {
  it("keeps the required asset list identical to what init writes", () => {
    expect([...REQUIRED_STORE_ASSETS].sort()).toEqual([...STORE_ASSET_PATHS].sort());
    const generated = generateAssets(
      brandingFrom("https://demo.freeholder.example", {
        name: "Freeholder",
        tagline: "Client app",
        branding: { colors: {} },
      }),
      null,
    );
    expect(Object.keys(generated.files).sort()).toEqual([...STORE_ASSET_PATHS].sort());
  });

  it("builds the demo discovery document from the seed and contract majors", () => {
    const demo = demoDiscoveryFromSources(demoFiles());
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;
    expect(demo.document.name).toBe(BUSINESS.name);
    expect(demo.document.tagline).toBe(BUSINESS.tagline);
    expect(demo.document.contractVersion).toBe(CONTRACT_VERSION);
    expect(demo.appContract).toBe(APP_CONTRACT_VERSION);
  });

  it("the app's discover() accepts the demo contract the gate builds", async () => {
    const demo = demoDiscoveryFromSources(demoFiles());
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;
    const result = await discover("https://demo.freeholder.example", async () => ({
      ok: true,
      status: 200,
      json: async () => demo.document,
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instance.name).toBe(BUSINESS.name);
  });

  it("fails an unparsable discovery contract", () => {
    expect(parseDiscoveryContract("not-json", 1).ok).toBe(false);
    expect(parseDiscoveryContract({ hello: true }, 1).reason).toBe("unparsable");
    expect(parseDiscoveryContract({ freeholder: true, setupComplete: false }, 1).reason).toBe(
      "unparsable",
    );
    expect(parseDiscoveryContract({ freeholder: true, name: "X" }, 1).reason).toBe("unparsable");
    expect(
      parseDiscoveryContract({ freeholder: true, contractVersion: 99, name: "X" }, 1).reason,
    ).toBe("app-too-old");
    const review = reviewMobileStore({
      appDir: "/tmp/does-not-matter",
      files: demoFiles(),
      contractPayload: { freeholder: true, name: "X" },
      appConfig: appConfig(),
      appPackage: appPackage(),
      exists: () => true,
      readFile: ((path: string) => {
        if (String(path).endsWith(".png")) return PNG_SIGNATURE;
        if (String(path).endsWith("metadata.json")) {
          return JSON.stringify({
            name: "X",
            privacyPolicyUrl: "https://x.example/privacy",
            ios: {},
            android: {},
            screenshots: [],
          });
        }
        return "ok\n";
      }) as typeof readFileSync,
    });
    expect(review.ok).toBe(false);
    expect(review.errors.join("\n")).toMatch(/unparsable contract/i);
  });

  it("fails a missing or non-PNG store asset from init", async () => {
    const dir = await scratch();
    await writeAssets(dir);
    expect(reviewStoreAssets(dir).ok).toBe(true);
    await rm(join(dir, "store/screenshots/02-catalog.png"));
    const missing = reviewStoreAssets(dir);
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain("missing store asset: store/screenshots/02-catalog.png");
    await writeFile(join(dir, "store/screenshots/02-catalog.png"), "not a png");
    const bad = reviewStoreAssets(dir);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join("\n")).toMatch(/not a PNG/);
  });

  it("fails a privacy manifest that does not match requested permissions", () => {
    const base = {
      appPackage: appPackage(),
      sourceText: "",
    };
    const tracking = reviewPrivacyManifest({
      ...base,
      appConfig: appConfig({
        ios: {
          bundleIdentifier: "ai.freeholder.customer",
          privacyManifests: { ...PRIVACY, NSPrivacyTracking: true, NSPrivacyTrackingDomains: ["trk.example"] },
        },
      }),
    });
    expect(tracking.ok).toBe(false);
    expect(tracking.errors.join("\n")).toMatch(/privacy manifest does not match requested permissions/);

    const camera = reviewPrivacyManifest({
      ...base,
      appConfig: appConfig({ plugins: ["expo-router", "expo-secure-store", "expo-camera"] }),
    });
    expect(camera.ok).toBe(false);
    expect(camera.errors.join("\n")).toMatch(/camera is requested/);

    const photosWithoutPermission = reviewPrivacyManifest({
      ...base,
      appConfig: appConfig({
        ios: {
          bundleIdentifier: "ai.freeholder.customer",
          privacyManifests: {
            ...PRIVACY,
            NSPrivacyCollectedDataTypes: [
              ...PRIVACY.NSPrivacyCollectedDataTypes,
              {
                NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePhotosorVideos",
                NSPrivacyCollectedDataTypeLinked: true,
                NSPrivacyCollectedDataTypeTracking: false,
                NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
              },
            ],
          },
        },
      }),
    });
    expect(photosWithoutPermission.ok).toBe(false);
    expect(photosWithoutPermission.errors.join("\n")).toMatch(/PhotosorVideos/);
  });

  it("accepts the current customer-app permission set", () => {
    const review = reviewPrivacyManifest({
      appConfig: appConfig(),
      appPackage: appPackage(),
      sourceText: "",
    });
    expect(review.errors).toEqual([]);
    expect(review.ok).toBe(true);
    expect(review.requested).toEqual([]);
  });

  it("passes a complete app directory against the demo contract", async () => {
    const dir = await scratch();
    await writeAssets(dir);
    const review = reviewMobileStore({
      appDir: dir,
      files: demoFiles(),
      appConfig: appConfig(),
      appPackage: appPackage(),
      sourceText: "",
    });
    expect(review.errors).toEqual([]);
    expect(review.ok).toBe(true);
  });

  it("the CLI exits 1 on an unparsable contract file", () => {
    const workspace = mkdtempSync(join(tmpdir(), "freeholder-store-cli-"));
    try {
      const contract = join(workspace, "bad.json");
      writeFileSync(contract, "{not json");
      mkdirSync(join(workspace, "apps/mobile"), { recursive: true });
      const gate = resolve("scripts/mobile-store-gate.mjs");
      const result = spawnSync(process.execPath, [gate, "--root", workspace, "--contract", contract], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/unparsable contract/i);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("the repository customer app passes the gate", () => {
    const review = runMobileStoreGate([], process.cwd());
    expect(review.errors).toEqual([]);
    expect(review.ok).toBe(true);
    expect(existsSync("apps/mobile/eas.json")).toBe(true);
  });
});

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
