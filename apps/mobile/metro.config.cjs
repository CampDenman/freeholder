// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.25: Metro must resolve the same shared package that TypeScript sees.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, "../../packages/mobile-app");
config.watchFolders = [...config.watchFolders, shared];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@freeholder/mobile-app") {
    return { type: "sourceFile", filePath: path.join(shared, "src/index.ts") };
  }
  // The publishable ESM package spells relative imports with .js. Metro
  // consumes its TypeScript source and needs extensionless resolution.
  if (context.originModulePath.startsWith(shared + path.sep) && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
