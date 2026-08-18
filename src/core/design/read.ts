// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Request-scoped resolved tokens (C2.15).
import { cache } from "react";
import { getDesign } from "./service";

const ANONYMOUS = { kind: "anonymous" } as const;

export const currentDesign = cache(() => getDesign.call({}, ANONYMOUS));
