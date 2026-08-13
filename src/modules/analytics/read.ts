// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Request-scoped analytics settings, shared by layout and page collection.
import { cache } from "react";
import { getModuleConfig } from "@/core/settings/service";
import {
  analyticsSettingsSchema,
  type AnalyticsSettings,
} from "./settings";

export const currentAnalyticsSettings = cache(async (): Promise<AnalyticsSettings> => {
  const config = await getModuleConfig.call(
    { module: "analytics" },
    { kind: "system" },
  );
  return analyticsSettingsSchema.parse(config);
});
