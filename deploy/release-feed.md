# Signed release feed

The update feed is a static `releases.json` published next to each versioned
image. The instance ships the Ed25519 public key that must have signed it. A
signature that does not verify is a hard stop — never a warning that scrolls
past.

This is not unattended self-update. Checking the feed on a schedule is C10.04.

## What each entry carries

Every release names its channel, `minFromVersion`, schema risk, CVSS/severity,
manual steps, plugin-API version, image digest, the image repository, a link
to the assembled notes, and the workflow that built it. The updater reads
those fields; it does not infer them from the version number.

The image itself is still signed keyless (cosign) with GitHub provenance and
an SPDX SBOM, as in [`ci-release-gate.md`](ci-release-gate.md). The feed
points at that digest; it does not replace image verification.

## Where it is published

On a matching version tag (including a beta), `Publish image` signs `releases.json` with
`FREEHOLDER_RELEASE_SIGNING_KEY` and uploads it as a release asset:

`https://github.com/CampDenman/freeholder/releases/download/<version-tag>/releases.json`

The default discovery endpoint is
`https://api.github.com/repos/CampDenman/freeholder/releases`.

## Key rotation

Trusted keys live in `src/core/update/trusted-release-keys.json`;
`src/core/update/keys.ts` exposes them to the runtime.

1. Generate a new Ed25519 key pair.
2. Add the new public key as `active` and mark the previous key `retiring`.
3. Store the new private key as `FREEHOLDER_RELEASE_SIGNING_KEY` and set
   the publication workflow’s `FREEHOLDER_RELEASE_KEY_ID` to the new id.
4. Ship that image. Feeds signed by either key still verify.
5. Once every supported image includes the new public key, remove the
   retiring key.

An instance never fetches a replacement key from the network. Rotation is
an image update.

`platform.verifyReleaseFeed` is the same hard stop Doctor describes as
`update.feed.key`.

The default updater discovers the newest published signed feed from this public
release list, including prereleases, and constructs the versioned asset URL in
the fixed upstream repository. It does not treat a beta as stable/latest; signed
feed verification and channel selection still apply.
