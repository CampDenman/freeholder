// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Printify-style fulfillment stays behind this plugin (MASTER.md §36, C3.13).
export interface PodSubmitInput {
  sku: string;
  provider: string;
  payload: Record<string, unknown>;
}

export interface PodSubmitResult {
  externalRef: string;
}

export interface PodProvider {
  submit(input: PodSubmitInput): Promise<PodSubmitResult>;
}

/** Fixture provider: succeeds unless the SKU asks it to fail. */
export const fixturePodProvider: PodProvider = {
  async submit(input) {
    if (input.sku.startsWith("fail-")) {
      throw new Error("The print provider refused that SKU.");
    }
    return { externalRef: `pod:${input.provider}:${input.sku}` };
  },
};

export function podProvider(): PodProvider {
  return fixturePodProvider;
}
