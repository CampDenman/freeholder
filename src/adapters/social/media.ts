// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Untrusted social-media URLs need the same DNS pinning as webhooks. Provider
// access tokens are deliberately absent: a post payload may name any URL.
import { AdapterError } from "../types";
import {
  getPinnedBytes,
  PinnedDownloadError,
  type PinnedDownloadOptions,
} from "@/core/http/pinned-download";

/** The current storage adapter accepts a buffer, so bound the proxy path. */
export const SOCIAL_MEDIA_DOWNLOAD_LIMIT = 25 * 1024 * 1024;

export interface SocialMediaDownloadOptions
  extends Omit<PinnedDownloadOptions, "headers" | "maxBytes"> {
  maxBytes?: number;
}

function failure(adapterId: string, message: string): AdapterError {
  return new AdapterError("social", adapterId, "provider_failure", message, true);
}

export async function downloadSocialMedia(
  adapterId: string,
  raw: string,
  options: SocialMediaDownloadOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const maxBytes = options.maxBytes ?? SOCIAL_MEDIA_DOWNLOAD_LIMIT;
  try {
    const result = await getPinnedBytes(raw, {
      ...options,
      maxBytes,
    });
    if (result.status < 200 || result.status >= 300) {
      throw failure(adapterId, `The provider refused the media (HTTP ${result.status}).`);
    }
    return result.bytes;
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    if (error instanceof PinnedDownloadError) {
      throw failure(
        adapterId,
        error.code === "too_large"
          ? "The provider returned oversized media."
          : error.code === "timeout"
            ? "The media request timed out."
            : "The provider media could not be reached safely.",
      );
    }
    throw failure(adapterId, "The provider media could not be reached safely.");
  }
}
