// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// DigitalOcean Spaces uses the existing signed S3-compatible implementation.
import { createS3Storage, type S3Config } from "./s3";
import type { StorageAdapter } from "./types";

export type SpacesConfig = Omit<S3Config, "endpoint">;

export function spacesEndpoint(region: string): string {
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error("Choose a DigitalOcean Spaces region such as sfo3.");
  return `https://${region}.digitaloceanspaces.com`;
}

export function createSpacesStorage(config: SpacesConfig): StorageAdapter {
  return createS3Storage({ ...config, endpoint: spacesEndpoint(config.region) });
}
