// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider-neutral generated alt-text boundary (MASTER.md C1.13).

export interface AltTextSuggestionInput {
  image: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface GeneratedAltText {
  text: string;
  provider: string;
  model: string;
}

export interface AltTextSuggester {
  readonly id: string;
  readonly model?: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
  suggest(input: AltTextSuggestionInput): Promise<GeneratedAltText>;
}

/** Safe, owner-facing provider failure; never includes credentials or bytes. */
export class AltTextSuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AltTextSuggestionError";
  }
}
