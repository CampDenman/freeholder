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

/** Scan engine prefix on a file that matched: evidence under legal hold. */
export const ABUSE_MATCH_ENGINE = "abuse-hash:";
/** Scan engine prefix on an image the matcher could not check: held, but rescannable. */
export const ABUSE_UNCHECKED_ENGINE = "abuse-hash-error:";

type Recorder = (record: AbuseMatchRecord) => Promise<void>;
let recorder: Recorder | undefined;
/**
 * Core media installs the one recorder at boot (src/core/media/abuse-evidence.ts).
 * One slot, not a list: booting again, or a dev-server reload, replaces it
 * rather than recording every match twice.
 */
export function setAbuseRecorder(next: Recorder | undefined): void {
  recorder = next;
}

export async function recordAbuseMatch(record: AbuseMatchRecord): Promise<void> {
  // Fails closed: a match nobody records must not be accepted quietly.
  if (!recorder) throw new Error("No recorder is registered for abuse matches.");
  await recorder(record);
}
