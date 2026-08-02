// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Request-scoped reads of the business profile.
//
// One render pass asks for the business several times over: the layout wants
// the site name, `generateMetadata` wants it for the title and Open Graph, and
// the page itself wants the tagline. Those are three components doing their
// own jobs correctly — none of them should have to know what the others
// fetched — and three identical queries per request is the price.
//
// React's `cache()` is the seam that removes the price without removing the
// independence: the first caller in a request runs the service, the rest get
// the same promise, and nothing has to thread a value down through props.
//
// It wraps the service rather than replacing it. Permission checks, audit and
// the transaction are all still the service layer's (§11); this only decides
// how often a request asks.
import { cache } from "react";
import { getBusiness } from "@/core/settings/service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** The business profile, fetched at most once per request. */
export const currentBusiness = cache(() => getBusiness.call({}, ANONYMOUS));
