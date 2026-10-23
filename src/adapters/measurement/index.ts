// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Choosing the measurement provider (C3.32): `MEASUREMENT_PROVIDER`, default
// `none`. See `./config` for the gates every adapter shares.
import { env } from "@/core/env";
import { measurementConfig } from "./config";
import {
  PARADISE_CLICK_ID_COOKIE,
  paradiseClickIds,
  paradiseScriptSources,
  recordParadiseConversion,
} from "./paradise";
import type { MeasurementAdapter } from "./types";

/** The configured adapter, or null when the category is off. */
export function measurement(): MeasurementAdapter | null {
  const config = measurementConfig(env());
  if (!config) return null;
  return {
    id: config.provider,
    displayName: config.displayName,
    scriptSources: () => paradiseScriptSources(config),
    clickIdCookie: PARADISE_CLICK_ID_COOKIE,
    clickIds: paradiseClickIds,
    recordConversion: (event) => recordParadiseConversion(config, event),
  };
}

export { measurementAllowed, measurementConfig, measurementCspOrigins } from "./config";
export type { LeadConversion, MeasurementAdapter } from "./types";
