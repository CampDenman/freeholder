// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A launch never follows a floating tag: given no digest, it resolves the
// current `edge` index to its linux/amd64 manifest and pins that.
export const IMAGE_REPOSITORY = "ghcr.io/campdenman/freeholder";
const DIGEST = /^ghcr\.io\/campdenman\/freeholder@sha256:[0-9a-f]{64}$/;

export function isPinned(image: string): boolean {
  return DIGEST.test(image);
}

export async function resolveEdgeImage(fetcher: typeof fetch = fetch): Promise<string> {
  const token = (await (await fetcher("https://ghcr.io/token?scope=repository:campdenman/freeholder:pull")).json()) as { token?: string };
  if (!token.token) throw new Error("GitHub's registry did not issue a pull token.");
  const response = await fetcher("https://ghcr.io/v2/campdenman/freeholder/manifests/edge", {
    headers: { authorization: `Bearer ${token.token}`, accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" },
  });
  if (!response.ok) throw new Error(`The edge image could not be read (${response.status}).`);
  const index = (await response.json()) as { manifests?: { digest: string; platform?: { os?: string; architecture?: string } }[] };
  const amd64 = index.manifests?.find((m) => m.platform?.os === "linux" && m.platform.architecture === "amd64");
  if (!amd64 || !/^sha256:[0-9a-f]{64}$/.test(amd64.digest)) throw new Error("The edge image has no linux/amd64 manifest.");
  return `${IMAGE_REPOSITORY}@${amd64.digest}`;
}
