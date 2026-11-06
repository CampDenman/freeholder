// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.44: when local-disk media is allowed, decided in one place. The storage
// adapter, Doctor, the update screen and update preflight all ask this module,
// so they cannot disagree about whether an instance's uploads are safe.
//
// The mistake §18 guards against is media written to somewhere that a rebuild
// throws away: a container's writable layer, or a relative directory inside
// the release that an update replaces. A single-server install that names an
// absolute directory it keeps across updates and includes in its nightly
// backup (the native installer's /var/lib/freeholder/media, or the Docker
// recipe's named volume) is not that mistake, so it is a supported mode.

import { isAbsolute } from "node:path";

export type LocalStorageMode =
  /** Not production: local disk is the development default. */
  | "development"
  /** Production with an explicit absolute directory the operator keeps. */
  | "persistent"
  /** Production on an implicit directory, accepted only by the legacy override. */
  | "unsafe"
  /** Production on an implicit directory, refused. */
  | "refused";

export interface LocalStorageEnvironment {
  NODE_ENV: string;
  LOCAL_STORAGE_ROOT?: string;
  FREEHOLDER_UNSAFE_LOCAL_STORAGE?: string;
}

export function localStorageMode(e: LocalStorageEnvironment): LocalStorageMode {
  if (e.NODE_ENV !== "production") return "development";
  // The legacy override keeps its exact meaning, including creating the
  // directory on demand: the hourly playground runs on a tmpfs /tmp/media
  // that is deliberately disposable.
  if (e.FREEHOLDER_UNSAFE_LOCAL_STORAGE === "1") return "unsafe";
  if (e.LOCAL_STORAGE_ROOT && isAbsolute(e.LOCAL_STORAGE_ROOT)) return "persistent";
  return "refused";
}

/** One sentence for Doctor and the update screen. */
export function describeLocalStorage(e: LocalStorageEnvironment): string {
  switch (localStorageMode(e)) {
    case "development":
      return "Local disk storage is for development.";
    case "persistent":
      return `Uploads are on this server's disk in ${e.LOCAL_STORAGE_ROOT}, which updates keep. Include it in backups (the self-host backup does).`;
    case "unsafe":
      return "Uploads are on this machine's disk because FREEHOLDER_UNSAFE_LOCAL_STORAGE=1.";
    case "refused":
      return "Uploads are configured for local disk in production without a persistent LOCAL_STORAGE_ROOT, so a rebuild or update would lose them.";
  }
}
