// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Store-readiness gate (MASTER.md §35, C10.16).
//
// CI already typechecks and `expo export`s both native platforms. This is the
// half that makes "submission-ready" a tested property rather than a promise:
// the demo discovery document must be something the binary can parse, init's
// store assets must all be present, and the privacy manifest must match the
// permissions the binary actually requests. Review outcomes stay the stores'
// call; this gate does not claim otherwise.
//
// Usage: node scripts/mobile-store-gate.mjs [--root <dir>] [--app-dir <dir>] [--contract <json>]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Same paths `generateAssets` writes. Tests bind this list to that function. */
export const REQUIRED_STORE_ASSETS = [
  "assets/icon.png",
  "assets/adaptive-icon.png",
  "assets/splash.png",
  "store/screenshots/01-home.png",
  "store/screenshots/02-catalog.png",
  "store/screenshots/03-bookings.png",
  "store/metadata.json",
  "store/ios/name.txt",
  "store/ios/subtitle.txt",
  "store/ios/description.txt",
  "store/ios/keywords.txt",
  "store/android/title.txt",
  "store/android/short-description.txt",
  "store/android/full-description.txt",
];

const USAGE_TO_PERMISSION = {
  NSCameraUsageDescription: "camera",
  NSMicrophoneUsageDescription: "microphone",
  NSPhotoLibraryUsageDescription: "photoLibrary",
  NSPhotoLibraryAddUsageDescription: "photoLibrary",
  NSLocationWhenInUseUsageDescription: "location",
  NSLocationAlwaysAndWhenInUseUsageDescription: "location",
  NSLocationAlwaysUsageDescription: "location",
  NSUserTrackingUsageDescription: "tracking",
  NSContactsUsageDescription: "contacts",
  NSBluetoothAlwaysUsageDescription: "bluetooth",
  NSBluetoothPeripheralUsageDescription: "bluetooth",
  NSFaceIDUsageDescription: "faceId",
};

const ANDROID_TO_PERMISSION = {
  "android.permission.CAMERA": "camera",
  "android.permission.RECORD_AUDIO": "microphone",
  "android.permission.READ_MEDIA_IMAGES": "photoLibrary",
  "android.permission.READ_EXTERNAL_STORAGE": "photoLibrary",
  "android.permission.WRITE_EXTERNAL_STORAGE": "photoLibrary",
  "android.permission.ACCESS_FINE_LOCATION": "location",
  "android.permission.ACCESS_COARSE_LOCATION": "location",
  "android.permission.ACCESS_BACKGROUND_LOCATION": "location",
  "android.permission.POST_NOTIFICATIONS": "notifications",
  "android.permission.READ_CONTACTS": "contacts",
  "android.permission.BLUETOOTH_CONNECT": "bluetooth",
  "android.permission.BLUETOOTH_SCAN": "bluetooth",
};

const PLUGIN_TO_PERMISSIONS = {
  "expo-camera": ["camera"],
  "expo-image-picker": ["camera", "photoLibrary"],
  "expo-media-library": ["photoLibrary"],
  "expo-location": ["location"],
  "expo-tracking-transparency": ["tracking"],
  "expo-notifications": ["notifications"],
  "expo-av": ["microphone"],
  "expo-contacts": ["contacts"],
  "expo-bluetooth": ["bluetooth"],
};

const SOURCE_HINTS = [
  { id: "camera", re: /\bexpo-camera\b|\bCameraView\b|\blaunchCameraAsync\b/ },
  { id: "photoLibrary", re: /\bexpo-image-picker\b|\bexpo-media-library\b|\blaunchImageLibraryAsync\b/ },
  { id: "location", re: /\bexpo-location\b|\bgetCurrentPositionAsync\b|\bwatchPositionAsync\b/ },
  { id: "tracking", re: /\bexpo-tracking-transparency\b|\brequestTrackingPermissionsAsync\b/ },
  { id: "notifications", re: /\bexpo-notifications\b|\bgetExpoPushTokenAsync\b/ },
  { id: "microphone", re: /\bexpo-av\b|\bAudio\.Recording\b/ },
  { id: "contacts", re: /\bexpo-contacts\b/ },
];

const COLLECTED_REQUIRES = {
  NSPrivacyCollectedDataTypePreciseLocation: "location",
  NSPrivacyCollectedDataTypeCoarseLocation: "location",
  NSPrivacyCollectedDataTypePhotosorVideos: ["camera", "photoLibrary"],
  NSPrivacyCollectedDataTypeContacts: "contacts",
  NSPrivacyCollectedDataTypeAdvertisingData: "tracking",
};

const REQUIRED_COLLECTED = [
  "NSPrivacyCollectedDataTypeEmailAddress",
  "NSPrivacyCollectedDataTypeName",
  "NSPrivacyCollectedDataTypeUserID",
];

const REASON_APIS_FROM_DEP = {
  "expo-secure-store": [
    { type: "NSPrivacyAccessedAPICategoryUserDefaults", reasons: ["CA92.1"] },
  ],
  "expo-file-system": [
    { type: "NSPrivacyAccessedAPICategoryFileTimestamp", reasons: ["C617.1"] },
    { type: "NSPrivacyAccessedAPICategoryDiskSpace", reasons: ["E174.1"] },
  ],
};

export function parseDiscoveryContract(payload, appContract) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      reason: "unparsable",
      message: "Discovery contract is not a JSON object.",
    };
  }
  const document = payload;
  if (document.freeholder !== true) {
    return {
      ok: false,
      reason: "unparsable",
      message: "That address does not look like a Freeholder site.",
    };
  }
  if (document.setupComplete === false) {
    return {
      ok: false,
      reason: "unparsable",
      message: "This site is not finished being set up yet.",
    };
  }
  if (typeof document.contractVersion !== "number" || !Number.isFinite(document.contractVersion)) {
    return {
      ok: false,
      reason: "unparsable",
      message: "Discovery contract is missing a contract version.",
    };
  }
  if (typeof document.name !== "string" || !document.name.trim()) {
    return {
      ok: false,
      reason: "unparsable",
      message: "Discovery contract is missing the business name.",
    };
  }
  if (document.contractVersion > appContract) {
    return {
      ok: false,
      reason: "app-too-old",
      message: `${document.name} needs a newer version of this app.`,
    };
  }
  return {
    ok: true,
    instance: {
      name: document.name.trim(),
      contractVersion: document.contractVersion,
      tagline: typeof document.tagline === "string" ? document.tagline : null,
    },
  };
}

function readExportedNumber(source, name) {
  const match = source.match(new RegExp(`export const ${name}(?:\\s*:\\s*\\w+)?\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function stringField(block, name) {
  const match = block.match(new RegExp(`${name}:\\s*"([^"]+)"`));
  return match?.[1] ?? null;
}

function stringArrayField(block, name) {
  const match = block.match(new RegExp(`${name}:\\s*\\[([^\\]]*)\\]`));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

export function demoBusinessFromSeed(source) {
  const match = source.match(/export const BUSINESS = \{([\s\S]*?)\n\};/);
  if (!match) return null;
  const block = match[1];
  const name = stringField(block, "name");
  if (!name) return null;
  return {
    name,
    tagline: stringField(block, "tagline"),
    country: stringField(block, "country") ?? "US",
    defaultLocale: stringField(block, "defaultLocale") ?? "en",
    enabledLocales: stringArrayField(block, "enabledLocales"),
    baseCurrency: stringField(block, "baseCurrency") ?? "USD",
    timezone: stringField(block, "timezone") ?? "UTC",
  };
}

export function demoDiscoveryFromSources(files) {
  const contractVersion = readExportedNumber(files.discovery ?? "", "CONTRACT_VERSION");
  const appContract = readExportedNumber(files.appDiscovery ?? "", "APP_CONTRACT_VERSION");
  const business = demoBusinessFromSeed(files.seed ?? "");
  const errors = [];
  if (contractVersion === null) errors.push("unparsable contract: src/core/discovery.ts has no CONTRACT_VERSION.");
  if (appContract === null) {
    errors.push("unparsable contract: packages/mobile-app/src/discovery.ts has no APP_CONTRACT_VERSION.");
  }
  if (!business) errors.push("unparsable contract: seed/demo/content.ts has no demo business.");
  if (errors.length) return { ok: false, errors };
  const origin = "https://demo.freeholder.example";
  return {
    ok: true,
    appContract,
    document: {
      freeholder: true,
      contractVersion,
      platformVersion: files.platformVersion ?? "0.1.0",
      name: business.name,
      tagline: business.tagline,
      locales: {
        default: business.defaultLocale,
        enabled: business.enabledLocales.length ? business.enabledLocales : [business.defaultLocale],
      },
      currency: business.baseCurrency,
      timezone: business.timezone,
      country: business.country,
      branding: { logoUrl: null, colors: {}, fontSans: null },
      api: {
        base: `${origin}/api/v1`,
        openapi: `${origin}/api/openapi.json`,
        mcp: `${origin}/api/mcp`,
      },
      storeUrls: { ios: null, android: null },
    },
  };
}

export function reviewStoreAssets(appDir, readFile = readFileSync, exists = existsSync) {
  const errors = [];
  for (const relativePath of REQUIRED_STORE_ASSETS) {
    const path = join(appDir, relativePath);
    if (!exists(path)) {
      errors.push(`missing store asset: ${relativePath}`);
      continue;
    }
    let bytes;
    try {
      bytes = readFile(path);
    } catch {
      errors.push(`missing store asset: ${relativePath}`);
      continue;
    }
    if (relativePath.endsWith(".png")) {
      const header = Buffer.isBuffer(bytes) ? bytes.subarray(0, 8) : Buffer.from(bytes).subarray(0, 8);
      if (!header.equals(PNG_SIGNATURE)) {
        errors.push(`missing store asset: ${relativePath} is not a PNG`);
      }
    }
  }
  const metadataPath = join(appDir, "store/metadata.json");
  if (exists(metadataPath)) {
    let metadata;
    try {
      metadata = JSON.parse(readFile(metadataPath, "utf8"));
    } catch {
      errors.push("missing store asset: store/metadata.json is not JSON");
      return { ok: errors.length === 0, errors };
    }
    if (!metadata || typeof metadata !== "object") {
      errors.push("missing store asset: store/metadata.json is not JSON");
    } else {
      for (const field of ["name", "privacyPolicyUrl", "ios", "android", "screenshots"]) {
        if (metadata[field] == null) {
          errors.push(`missing store asset: store/metadata.json is missing ${field}`);
        }
      }
      if (Array.isArray(metadata.screenshots)) {
        for (const shot of metadata.screenshots) {
          if (typeof shot === "string" && !exists(join(appDir, shot))) {
            errors.push(`missing store asset: ${shot}`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function pluginNames(plugins) {
  if (!Array.isArray(plugins)) return [];
  return plugins.map((entry) => (Array.isArray(entry) ? entry[0] : entry)).filter((name) => typeof name === "string");
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function requestedPermissions({ appConfig, appPackage, sourceText }) {
  const requested = new Set();
  const expo = record(record(appConfig).expo);
  const infoPlist = record(record(expo.ios).infoPlist);
  for (const [key, permission] of Object.entries(USAGE_TO_PERMISSION)) {
    if (typeof infoPlist[key] === "string" && infoPlist[key].trim()) requested.add(permission);
  }
  const androidPermissions = record(expo.android).permissions;
  if (Array.isArray(androidPermissions)) {
    for (const name of androidPermissions) {
      const permission = ANDROID_TO_PERMISSION[name];
      if (permission) requested.add(permission);
    }
  }
  for (const plugin of pluginNames(expo.plugins)) {
    for (const permission of PLUGIN_TO_PERMISSIONS[plugin] ?? []) requested.add(permission);
  }
  const dependencies = {
    ...record(record(appPackage).dependencies),
    ...record(record(appPackage).devDependencies),
  };
  for (const [dep, permissions] of Object.entries(PLUGIN_TO_PERMISSIONS)) {
    if (dependencies[dep]) for (const permission of permissions) requested.add(permission);
  }
  const code = stripComments(sourceText ?? "");
  for (const hint of SOURCE_HINTS) {
    if (hint.re.test(code)) requested.add(hint.id);
  }
  return requested;
}

function collectedTypes(manifest) {
  const entries = Array.isArray(manifest.NSPrivacyCollectedDataTypes) ? manifest.NSPrivacyCollectedDataTypes : [];
  return entries
    .map((entry) => (entry && typeof entry === "object" ? entry.NSPrivacyCollectedDataType : null))
    .filter((type) => typeof type === "string");
}

function accessedApis(manifest) {
  const entries = Array.isArray(manifest.NSPrivacyAccessedAPITypes) ? manifest.NSPrivacyAccessedAPITypes : [];
  const map = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const type = entry.NSPrivacyAccessedAPIType;
    const reasons = Array.isArray(entry.NSPrivacyAccessedAPITypeReasons)
      ? entry.NSPrivacyAccessedAPITypeReasons.filter((reason) => typeof reason === "string")
      : [];
    if (typeof type === "string") map.set(type, reasons);
  }
  return map;
}

export function reviewPrivacyManifest({ appConfig, appPackage, sourceText }) {
  const errors = [];
  const expo = record(record(appConfig).expo);
  const manifest = record(record(expo.ios).privacyManifests);
  const requested = requestedPermissions({ appConfig, appPackage, sourceText });
  const trackingDeclared = manifest.NSPrivacyTracking === true;
  const mismatch = (detail) => `privacy manifest does not match requested permissions: ${detail}`;

  if (requested.has("tracking") !== trackingDeclared) {
    errors.push(
      mismatch(
        requested.has("tracking")
          ? "the binary requests tracking but NSPrivacyTracking is not true"
          : "NSPrivacyTracking is true but the binary does not request tracking",
      ),
    );
  }
  if (trackingDeclared && (!Array.isArray(manifest.NSPrivacyTrackingDomains) || manifest.NSPrivacyTrackingDomains.length === 0)) {
    errors.push(mismatch("NSPrivacyTracking is true but no tracking domains are listed"));
  }

  const collected = collectedTypes(manifest);
  for (const type of REQUIRED_COLLECTED) {
    if (!collected.includes(type)) {
      errors.push(mismatch(`missing ${type} (sign-in collects it)`));
    }
  }
  for (const [type, need] of Object.entries(COLLECTED_REQUIRES)) {
    if (!collected.includes(type)) continue;
    const needs = Array.isArray(need) ? need : [need];
    if (!needs.some((permission) => requested.has(permission))) {
      errors.push(mismatch(`${type} is declared but the binary does not request ${needs.join(" or ")}`));
    }
  }
  for (const permission of ["camera", "photoLibrary", "location", "microphone", "contacts", "bluetooth", "faceId", "notifications"]) {
    if (!requested.has(permission)) continue;
    if (permission === "camera" || permission === "photoLibrary") {
      if (!collected.includes("NSPrivacyCollectedDataTypePhotosorVideos")) {
        errors.push(mismatch(`${permission} is requested but PhotosorVideos is not declared`));
      }
    }
    if (permission === "location" && !collected.includes("NSPrivacyCollectedDataTypePreciseLocation")
      && !collected.includes("NSPrivacyCollectedDataTypeCoarseLocation")) {
      errors.push(mismatch("location is requested but no location data type is declared"));
    }
    if (permission === "contacts" && !collected.includes("NSPrivacyCollectedDataTypeContacts")) {
      errors.push(mismatch("contacts are requested but Contacts is not declared"));
    }
  }

  const declaredApis = accessedApis(manifest);
  const dependencies = {
    ...record(record(appPackage).dependencies),
    ...record(record(appPackage).devDependencies),
  };
  const requiredApis = [];
  for (const [dep, apis] of Object.entries(REASON_APIS_FROM_DEP)) {
    if (dependencies[dep]) requiredApis.push(...apis);
  }
  for (const api of requiredApis) {
    const reasons = declaredApis.get(api.type);
    if (!reasons) {
      errors.push(mismatch(`missing ${api.type} required-reason API`));
      continue;
    }
    for (const reason of api.reasons) {
      if (!reasons.includes(reason)) {
        errors.push(mismatch(`${api.type} is missing reason ${reason}`));
      }
    }
  }
  for (const type of declaredApis.keys()) {
    if (!requiredApis.some((api) => api.type === type)) {
      errors.push(mismatch(`undeclared required-reason API ${type} is not used by the binary`));
    }
  }

  return { ok: errors.length === 0, errors, requested: [...requested].sort() };
}

function walkFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, files);
    else if (entry.isFile() && /\.(ts|tsx|js|json)$/.test(entry.name)) files.push(path);
  }
  return files;
}

export function readWorkspaceSources(root, appDir) {
  const files = {};
  const discovery = join(root, "src/core/discovery.ts");
  const appDiscovery = join(root, "packages/mobile-app/src/discovery.ts");
  const seed = join(root, "seed/demo/content.ts");
  const pkg = join(root, "package.json");
  if (existsSync(discovery)) files.discovery = readFileSync(discovery, "utf8");
  if (existsSync(appDiscovery)) files.appDiscovery = readFileSync(appDiscovery, "utf8");
  if (existsSync(seed)) files.seed = readFileSync(seed, "utf8");
  if (existsSync(pkg)) {
    try {
      files.platformVersion = JSON.parse(readFileSync(pkg, "utf8")).version ?? "0.1.0";
    } catch {
      files.platformVersion = "0.1.0";
    }
  }
  const sourceRoots = [join(appDir, "app"), join(appDir, "src"), join(root, "packages/mobile-app/src")];
  const parts = [];
  for (const dir of sourceRoots) {
    for (const path of walkFiles(dir)) parts.push(readFileSync(path, "utf8"));
  }
  files.sourceText = parts.join("\n");
  return files;
}

export function reviewMobileStore(options) {
  const errors = [];
  const notes = [];
  const demo = demoDiscoveryFromSources(options.files ?? {});
  if (!demo.ok) {
    return { ok: false, errors: demo.errors, notes, demo: null, parsed: null };
  }
  const payload = options.contractPayload ?? demo.document;
  const parsed = parseDiscoveryContract(payload, options.appContract ?? demo.appContract);
  if (!parsed.ok) {
    const prefix = parsed.reason === "unparsable" ? "unparsable contract" : parsed.reason;
    errors.push(`${prefix}: ${parsed.message}`);
  } else {
    notes.push(`demo contract ${demo.document.contractVersion} parsable as ${parsed.instance.name}`);
  }

  const assets = reviewStoreAssets(options.appDir, options.readFile ?? readFileSync, options.exists ?? existsSync);
  errors.push(...assets.errors);

  const privacy = reviewPrivacyManifest({
    appConfig: options.appConfig ?? {},
    appPackage: options.appPackage ?? {},
    sourceText: options.sourceText ?? options.files?.sourceText ?? "",
  });
  errors.push(...privacy.errors);

  return {
    ok: errors.length === 0,
    errors,
    notes,
    demo,
    parsed,
    requested: privacy.requested,
  };
}

function flagValue(argv, name) {
  const index = argv.indexOf(`--${name}`);
  const found = index >= 0 ? argv[index + 1] : undefined;
  return found && !found.startsWith("--") ? found : undefined;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runMobileStoreGate(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = resolve(cwd, flagValue(argv, "root") ?? ".");
  const appDir = resolve(root, flagValue(argv, "app-dir") ?? "apps/mobile");
  const contractPath = flagValue(argv, "contract");
  const files = readWorkspaceSources(root, appDir);
  let contractPayload;
  if (contractPath) {
    const absolute = resolve(cwd, contractPath);
    if (!existsSync(absolute)) {
      return { ok: false, errors: [`unparsable contract: ${contractPath} does not exist`], notes: [] };
    }
    try {
      contractPayload = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      return { ok: false, errors: ["unparsable contract: contract file is not JSON"], notes: [] };
    }
  }
  const appJsonPath = join(appDir, "app.json");
  const packagePath = join(appDir, "package.json");
  const appConfig = existsSync(appJsonPath) ? readJsonFile(appJsonPath) : {};
  const appPackage = existsSync(packagePath) ? readJsonFile(packagePath) : {};
  return reviewMobileStore({
    appDir,
    files,
    contractPayload,
    appConfig,
    appPackage,
    sourceText: files.sourceText,
  });
}

function printReview(review, out) {
  for (const note of review.notes ?? []) out.log(note);
  if (review.ok) {
    out.log("Mobile store gate: demo contract, store assets and privacy manifest are ready.");
    return;
  }
  out.error("Mobile store gate failed:");
  for (const error of review.errors) out.error(`  - ${error}`);
}

export async function main(argv = process.argv.slice(2), out = console, cwd = process.cwd()) {
  const review = runMobileStoreGate(argv, cwd);
  printReview(review, out);
  return review.ok ? 0 : 1;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  main().then((code) => {
    process.exitCode = code;
  });
}

