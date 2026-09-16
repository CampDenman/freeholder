// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A ZIP container for finished galleries (MASTER.md §4.5, C8.07).
//
// Written here rather than taken as a dependency. The format subset a delivery
// archive needs is small and stable — local header, central directory, end
// record — and §36 puts the media pipeline among the things Freeholder absorbs
// rather than delegates. A dependency for this would be supply-chain surface
// bought with nothing.
//
// Entries are STORED, not deflated. A gallery is JPEG and WebP, which are
// already compressed: deflating them costs CPU across every file and returns
// close to zero. The trade would be different for text.
//
// The 4 GiB / 65,535-entry ceilings of the original format are not raised
// here; `zipCeilingExceeded` reports when a gallery is too large rather than
// writing an archive that unzips wrong. ZIP64 can follow the first owner who
// needs it.
import { createHash } from "node:crypto";

/** The classic format's hard limits. Beyond these, ZIP64 is required. */
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

export interface ArchiveEntry {
  /** Path inside the archive. Duplicates are made unique by the caller. */
  name: string;
  body: Uint8Array<ArrayBuffer>;
  /** Last-modified, written into the DOS timestamp fields. */
  modifiedAt: Date;
}

export interface BuiltArchive {
  body: Uint8Array<ArrayBuffer>;
  entries: number;
  bytes: number;
  sha256: string;
}

/** CRC-32, the checksum every ZIP entry carries. Table built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what the original format stores.
 *
 * Two-second resolution and a 1980 epoch are the format's, not ours. A file
 * older than 1980 is clamped rather than written as a negative year that some
 * readers render as 2107.
 */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time:
      (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** True when this set cannot be written as a classic ZIP. */
export function zipCeilingExceeded(entries: ArchiveEntry[]): boolean {
  if (entries.length > MAX_ENTRIES) return true;
  const total = entries.reduce((sum, entry) => sum + entry.body.length, 0);
  // Generous headroom for headers and names rather than an exact prediction:
  // being wrong here writes a corrupt archive, and being cautious only refuses
  // a gallery that was about to break anyway.
  return total > MAX_BYTES - 1_000_000;
}

/**
 * Make every entry name unique.
 *
 * Two photographs can carry the same filename, and a ZIP with two identical
 * paths extracts as one file — silently delivering fewer images than the
 * client chose.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 180) || "file";
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${name.slice(0, dot)} (${count})${name.slice(dot)}`
      : `${name} (${count})`;
  });
}

export function buildZip(entries: ArchiveEntry[]): BuiltArchive {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.body);
    const { time, date } = dosStamp(entry.modifiedAt);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.body.length, true);
    local.setUint32(22, entry.body.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, entry.body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory header
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, entry.body.length, true);
    dir.setUint32(24, entry.body.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true);
    dir.setUint16(32, 0, true);
    dir.setUint16(34, 0, true);
    dir.setUint16(36, 0, true);
    dir.setUint32(38, 0, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + entry.body.length;
  });

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.length;
  }

  return {
    body,
    entries: entries.length,
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}
