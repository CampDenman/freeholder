// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.21: read the files a MediaAttach control added to a form.
export function attachmentsFrom(form: FormData): { assetId: string; altText: string }[] {
  return form
    .getAll("attachment")
    .filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v))
    .slice(0, 4)
    .map((assetId) => {
      const alt = form.get(`alt:${assetId}`);
      return { assetId, altText: typeof alt === "string" ? alt.trim().slice(0, 500) : "" };
    });
}
