// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Known-abuse-imagery hash matching (MASTER.md C12.30).
//
// A provider compares an uploaded image with a vetted list of known child
// sexual abuse material and says whether it matches. Access to these lists
// is granted only to vetted organisations, so each provider needs the site
// owner's own agreement with it. Only files the site can see are scanned:
// end-to-end encrypted attachments (C12.36) are opaque to the server.

export interface AbuseMatch {
  matched: boolean;
  /** The provider's identifier for the match, for the legal report. */
  matchId?: string;
  /** Which list matched, when the provider says. */
  source?: string;
}

export interface AbuseScanner {
  readonly id: "none" | "photodna" | "safer";
  /** Missing configuration; empty when the scanner can run. */
  missing(): string[];
  match(input: { bytes: Uint8Array<ArrayBuffer>; contentType: string }): Promise<AbuseMatch>;
}
