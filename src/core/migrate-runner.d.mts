// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import type postgres from "postgres";
import type {MigrationConfig,MigrationMeta} from "drizzle-orm/migrator";
export const MIGRATION_LOCK_NAMESPACE:0x46726565;
export const MIGRATION_LOCK_KEY:0x686f6c64;
export const SAFE_RESPONSE_BOUNDARY:Readonly<{index:86;tag:"0086_controlled_safe_response";when:1793310000066;breakpoints:true;firstStatementBytes:2599;firstStatementSha256:"be98ff6d34b55b22adec262f4e3833cc653ab268e4767d9530d2b98c7835919f"}>;
export interface MigrationJournalEntry {idx:number;version:string;when:number;tag:string;breakpoints:boolean}
export type MigrationPlan={kind:"legacy";all:MigrationMeta[]}|{kind:"boundary";all:MigrationMeta[];before:MigrationMeta[];boundary:MigrationMeta[];after:MigrationMeta[]};
export function migrationPrefixFingerprint(entries:readonly MigrationJournalEntry[],migrations:readonly MigrationMeta[]):string;
export function readMigrationPlan(config:MigrationConfig):MigrationPlan;
export function runMigrationsOnDedicatedSession(client:ReturnType<typeof postgres>,config:MigrationConfig):Promise<void>;
