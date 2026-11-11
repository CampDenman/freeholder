// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.41: every default provider request uses this plugin's declared scopes.
import { createPluginHttp } from "@/core/plugins/fetch";
import manifest from "./manifest";

export const pluginHttp = createPluginHttp(manifest);
