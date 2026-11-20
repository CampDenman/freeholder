// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface HtmlMetadata { title: string; canonical: string; description: string; robots: string; ogTitle: string; ogDescription: string; ogImage: string; hreflang: Record<string, string> }
export interface MigrationCheck { sourceUrl: string; requestPath: string; destinationPath: string; redirect: boolean; expected: Record<string, unknown> }
export interface MigrationWindowIdentity { runId: string; generation: string; planDigest: string }
export interface MigrationPlan {
  sourceOrigin: string;
  status: string;
  warnings: string[];
  checks: MigrationCheck[];
  window?: MigrationWindowIdentity & { afterOrdinal: number };
  nextOrdinal?: number | null;
}
export interface MigrationReport {
  verifiedAt: string;
  destinationOrigin: string;
  status: string;
  accepted: boolean;
  unresolved: string[];
  rows: Array<MigrationCheck & { errors: string[]; warnings: string[]; sourceMeta?: HtmlMetadata; destinationMeta?: HtmlMetadata }>;
  windowSequence?: MigrationWindowIdentity & { count: number };
}
export function htmlMetadata(html: string): HtmlMetadata;
export function verifyMigration(plan: MigrationPlan | MigrationPlan[], destinationOrigin: string): Promise<MigrationReport>;
