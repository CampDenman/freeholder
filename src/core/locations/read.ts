// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Request-scoped reads of the primary location, matching settings/read.ts.
//
// The footer wants the NAP, the home page's JSON-LD wants the same row, and a
// NAP block on the contact page wants it again. Three components doing their
// own jobs correctly; one query. See settings/read.ts for the reasoning — this
// is the same seam for the same reason.
import { cache } from "react";
import { primaryLocation } from "@/core/locations/service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** The primary location, fetched at most once per request. Null is a real answer. */
export const currentLocation = cache(() => primaryLocation.call({}, ANONYMOUS));
