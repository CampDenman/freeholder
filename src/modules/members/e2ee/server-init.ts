// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: load the committed runtime before a business transaction can begin.
// Keep filesystem access out of the browser's crypto module graph.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initializeOpenMls } from "./crypto";

initializeOpenMls(readFileSync(join(process.cwd(), "public/_freeholder/openmls/0.1.0/freeholder_openmls_bg.wasm")));
