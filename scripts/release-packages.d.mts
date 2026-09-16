// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export const PACKAGE_FOLDERS: string[];
export function releaseTag(version: string): string;
export function parseReleaseTag(tag: string): string | null;
export function sdkVersionFromSource(source: string): string | null;
export function readAlignedVersion(root?: string): Promise<string>;
export function assertTagMatchesVersion(ref: string, version: string): void;
export function publishTarballs(
  archives: string,
  options?: { publish?: boolean; token?: string; cwd?: string },
): Promise<string[]>;
