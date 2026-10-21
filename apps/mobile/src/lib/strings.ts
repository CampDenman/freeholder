// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { appText } from "@freeholder/mobile-app";
import { useInstance } from "./instance";

export function useAppText(): (key: string) => string {
  const { instance } = useInstance();
  return (key) => appText(instance?.locales.default ?? "en", key);
}
