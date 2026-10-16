// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The site's known-abuse-imagery scanner (C12.30), chosen by ABUSE_SCAN_PROVIDER.
import { env } from "@/core/env";
import { createPhotoDna } from "./photodna";
import { saferScanner } from "./safer";
import type { AbuseMatch, AbuseScanner } from "./types";

export type { AbuseMatch, AbuseScanner } from "./types";

const none: AbuseScanner = { id: "none", missing: () => [], match: async () => ({ matched: false }) };

let instance: AbuseScanner | undefined;
export function abuseScanner(): AbuseScanner {
  if (instance) return instance;
  const provider = env().ABUSE_SCAN_PROVIDER;
  instance = provider === "photodna" ? createPhotoDna() : provider === "safer" ? saferScanner : none;
  return instance;
}

export function setAbuseScannerForTests(scanner: AbuseScanner | undefined): void {
  instance = scanner;
}

/** What a match leaves behind: never the image, only what identifies it for the report. */
export interface AbuseMatchRecord extends AbuseMatch {
  provider: AbuseScanner["id"];
  sha256: string;
  contentType: string;
  bytes: number;
}

type Handler = (record: AbuseMatchRecord) => Promise<void>;
const handlers: Handler[] = [];
/** The members module records matches for the legal report. */
export function onAbuseMatch(handler: Handler): void {
  handlers.push(handler);
}

export async function recordAbuseMatch(record: AbuseMatchRecord): Promise<void> {
  for (const handler of handlers) await handler(record);
}
