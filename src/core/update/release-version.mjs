// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Published SemVer identities, shared by runtime and release tooling (C10.02).
const numeric = "(?:0|[1-9][0-9]*)";
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
export const RELEASE_VERSION = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`);

function compareIdentifier(a, b) {
  const aNumeric = /^[0-9]+$/.test(a);
  const bNumeric = /^[0-9]+$/.test(b);
  if (aNumeric && bNumeric) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareReleaseVersions(a, b) {
  if (!RELEASE_VERSION.test(a) || !RELEASE_VERSION.test(b)) return null;
  const [aCore, aPre] = a.split(/-(.*)/s);
  const [bCore, bPre] = b.split(/-(.*)/s);
  const left = aCore.split(".");
  const right = bCore.split(".");
  for (let i = 0; i < 3; i += 1) {
    const order = compareIdentifier(left[i], right[i]);
    if (order) return order;
  }
  if (!aPre || !bPre) return aPre ? -1 : bPre ? 1 : 0;
  const aParts = aPre.split(".");
  const bParts = bPre.split(".");
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    if (aParts[i] === undefined) return -1;
    if (bParts[i] === undefined) return 1;
    const order = compareIdentifier(aParts[i], bParts[i]);
    if (order) return order;
  }
  return 0;
}
