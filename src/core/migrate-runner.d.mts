// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import type postgres from "postgres";
import type {MigrationConfig,MigrationMeta} from "drizzle-orm/migrator";
export const MIGRATION_LOCK_NAMESPACE:0x46726565;
export const MIGRATION_LOCK_KEY:0x686f6c64;
export const SAFE_RESPONSE_BOUNDARY:Readonly<{index:86;tag:"0086_controlled_safe_response";when:1793310000066;breakpoints:true;firstStatementBytes:2038;firstStatementSha256:"14b90f4109f06e5457ddaa0b0c0210516092f0e2e6d8965d067eca7c3370b8d4"}>;
export interface MigrationJournalEntry {idx:number;version:string;when:number;tag:string;breakpoints:boolean}
export type MigrationPlan={kind:"legacy";all:MigrationMeta[]}|{kind:"boundary";all:MigrationMeta[];before:MigrationMeta[];boundary:MigrationMeta[];after:MigrationMeta[]};
export function migrationPrefixFingerprint(entries:readonly MigrationJournalEntry[],migrations:readonly MigrationMeta[]):string;
export function readMigrationPlan(config:MigrationConfig):MigrationPlan;
export function runMigrationsOnDedicatedSession(client:ReturnType<typeof postgres>,config:MigrationConfig):Promise<void>;
