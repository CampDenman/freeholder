// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { signUploadParts } from "@/core/media/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(signUploadParts);
