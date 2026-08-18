// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One version string for health, admin, CLI, OpenAPI and the SDK (C3.20).
import { version } from "../../package.json";

/** Semver of this build. The same value health, OpenAPI and the SDK publish. */
export const PLATFORM_VERSION: string = version;

/**
 * Shape of the outbound webhook envelope. Bump when the wire format changes;
 * receivers can reject an unknown version instead of guessing.
 */
export const WEBHOOK_SCHEMA_VERSION = 1 as const;

export const CONTRACT = {
  openapi: "3.1.0",
  mcpProtocol: "2025-06-18",
  webhookSchema: WEBHOOK_SCHEMA_VERSION,
} as const;
