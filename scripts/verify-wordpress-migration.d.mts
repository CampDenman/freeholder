// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface HtmlMetadata { title: string; canonical: string; description: string; robots: string; ogTitle: string; ogDescription: string; ogImage: string; hreflang: Record<string, string> }
export interface MigrationCheck { sourceUrl: string; requestPath: string; destinationPath: string; redirect: boolean; expected: Record<string, unknown> }
export interface MigrationPlan { sourceOrigin: string; status: string; warnings: string[]; checks: MigrationCheck[] }
export interface MigrationReport { verifiedAt: string; destinationOrigin: string; status: string; accepted: boolean; unresolved: string[]; rows: Array<MigrationCheck & { errors: string[]; warnings: string[]; sourceMeta?: HtmlMetadata; destinationMeta?: HtmlMetadata }> }
export function htmlMetadata(html: string): HtmlMetadata;
export function verifyMigration(plan: MigrationPlan, destinationOrigin: string): Promise<MigrationReport>;
