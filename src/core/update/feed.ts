// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Verify a signed releases.json against the keys this instance ships (C10.03).
import {
  ReleaseFeedError,
  verifyFeed as verifySignedFeed,
} from "../../../scripts/release-feed.mjs";
import { TRUSTED_RELEASE_KEYS, type TrustedReleaseKey } from "./keys";
import { parseReleaseMetadata, type ReleaseMetadata } from "./release";

export { FEED_SCHEMA, ReleaseFeedError, signFeed, canonicalJson } from "../../../scripts/release-feed.mjs";

export interface VerifiedRelease extends ReleaseMetadata {
  digest: string;
  image: string;
  notesUrl: string;
  publishedAt: string;
  provenance: {
    repository: string;
    workflow: string;
  };
}

export interface VerifiedFeed {
  schema: string;
  keyId: string;
  signedAt: string;
  releases: VerifiedRelease[];
}

export function verifyReleaseFeed(
  document: unknown,
  keys: readonly TrustedReleaseKey[] = TRUSTED_RELEASE_KEYS,
): VerifiedFeed {
  const envelope = verifySignedFeed(document, [...keys]);
  const releases = Array.isArray(envelope.releases) ? envelope.releases : [];
  return {
    schema: String(envelope.schema),
    keyId: String(envelope.keyId),
    signedAt: String(envelope.signedAt),
    releases: releases.map((entry) => {
      let metadata: ReleaseMetadata;
      try {
        metadata = parseReleaseMetadata(entry);
      } catch (error) {
        throw new ReleaseFeedError(
          `${error instanceof Error ? error.message : "Release metadata is invalid."} Refusing to read it. This is not a warning.`,
        );
      }
      const record = entry as Record<string, unknown>;
      const provenance = record.provenance as { repository?: string; workflow?: string } | undefined;
      if (typeof record.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.digest)) {
        throw new ReleaseFeedError("A signed release is missing its image digest. Refusing to read it. This is not a warning.");
      }
      if (typeof record.image !== "string" || !record.image) {
        throw new ReleaseFeedError("A signed release is missing its image name. Refusing to read it. This is not a warning.");
      }
      if (typeof record.notesUrl !== "string" || !record.notesUrl) {
        throw new ReleaseFeedError("A signed release is missing its release notes. Refusing to read it. This is not a warning.");
      }
      if (!provenance?.repository || !provenance.workflow) {
        throw new ReleaseFeedError("A signed release is missing build provenance. Refusing to read it. This is not a warning.");
      }
      if (typeof record.publishedAt !== "string" || !record.publishedAt) {
        throw new ReleaseFeedError("A signed release is missing publishedAt. Refusing to read it. This is not a warning.");
      }
      return {
        ...metadata,
        digest: record.digest,
        image: record.image,
        notesUrl: record.notesUrl,
        publishedAt: record.publishedAt,
        provenance: {
          repository: provenance.repository,
          workflow: provenance.workflow,
        },
      };
    }),
  };
}
