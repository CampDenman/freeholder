// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Core's service list — the default export a manifest's `services` loader is
// expected to provide (MASTER.md §11). Adding a service to core means adding
// it to the array it already lives in; forgetting to register it is not a
// separate mistake anyone can make.
import authServices from "@/core/auth/service";
import resetServices from "@/core/auth/reset";
import contactServices from "@/core/contacts/service";
import doctorServices from "@/core/doctor/service";
import eventServices from "@/core/events/service";
import i18nServices from "@/core/i18n/service";
import locationServices from "@/core/locations/service";
import mediaServices from "@/core/media/service";
import seoServices from "@/core/seo/service";
import settingsServices from "@/core/settings/service";
import type { Service } from "@/core/service";

const services: Service[] = [
  ...authServices,
  ...resetServices,
  ...contactServices,
  ...doctorServices,
  ...eventServices,
  ...i18nServices,
  ...locationServices,
  ...mediaServices,
  ...seoServices,
  ...settingsServices,
];

export default services;
