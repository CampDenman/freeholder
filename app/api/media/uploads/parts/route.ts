// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { signUploadParts } from "@/core/media/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(signUploadParts);
