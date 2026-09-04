// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One definition of an address an unattended outbound request may reach.
import { BlockList, isIP } from "node:net";

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 32], // Teredo transition addresses
  ["2001:2::", 48], // benchmarking
  ["2001:10::", 28], // ORCHID
  ["2001:20::", 28], // ORCHIDv2
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 can encode a prohibited IPv4 destination
  ["3fff::", 20], // documentation
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

export function normalizeIpAddress(address: string): string {
  return address.replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
}

/** True only for an ordinary globally routable unicast address. */
export function isPublicIpAddress(input: string): boolean {
  const address = normalizeIpAddress(input);
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family !== 6) return false;
  // Refuse all IPv4-mapped forms rather than maintaining two interpretations
  // of the same endpoint across DNS, URL and socket libraries.
  if (address.toLowerCase().includes("::ffff:")) return false;
  return globalIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
}
