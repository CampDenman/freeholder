// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deterministic real ZIP bytes for fictional original-file qualifications.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function originalStaticZip(files: Array<{ path: string; body: string | Uint8Array }>, reverseDirectory = false) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path), body = typeof file.body === "string" ? Buffer.from(file.body) : Buffer.from(file.body);
    let value = 0xffffffff;
    for (const byte of body) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
    const checksum = (value ^ 0xffffffff) >>> 0, header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(Buffer.concat([record, name])); offset += header.length + name.length + body.length;
  }
  if (reverseDirectory) central.reverse();
  const table = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, table, end]));
}
