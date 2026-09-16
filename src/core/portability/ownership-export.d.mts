// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export const EXPORT_FORMAT: string;
export const SECRET_COLUMNS: ReadonlySet<string>;
export function canonicalJson(value: unknown): string;
export function sha256(value: string | Buffer): string;
export function isSecretColumn(column: string): boolean;
export function credentialKeyFingerprint(value?: string): string | null;
export interface MediaManifest {
  format: string;
  assets: Array<Record<string, unknown>>;
  objects: Array<Record<string, unknown>>;
  integrity: {
    missingInventoryKeys: string[];
    unreferencedInventoryKeys: string[];
  };
}
export function buildMediaManifest(
  assetRows: Array<Record<string, unknown>>,
  objectRows: Array<Record<string, unknown>>,
): MediaManifest;
export function databaseFingerprint(
  databaseUrl: string,
): Promise<Array<{ schema: string; table: string; rows: number; sha256: string }>>;
export function createOwnershipExport(options: {
  databaseUrl: string;
  outputDirectory: string;
  configuration: {
    filename: string;
    contents: string;
  };
  environment?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{
  outputDirectory: string;
  manifest: {
    format: string;
    tableCount: number;
    rowCount: number;
    secretValuesIncluded: false;
    completeTableInventory: true;
    tables: Array<{
      schema: string;
      table: string;
      rows: number;
      redactedColumns: string[];
      file: string;
    }>;
    media: {
      assetCount: number;
      objectCount: number;
      missingInventoryKeys: number;
      unreferencedInventoryKeys: number;
    };
  };
}>;
