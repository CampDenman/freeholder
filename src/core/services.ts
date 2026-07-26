// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Core's service list — the default export a manifest's `services` loader is
// expected to provide (MASTER.md §11). Adding a service to core means adding
// it to the array it already lives in; forgetting to register it is not a
// separate mistake anyone can make.
import authServices from "@/core/auth/service";
import contactServices from "@/core/contacts/service";
import type { Service } from "@/core/service";

const services: Service[] = [...authServices, ...contactServices];

export default services;
