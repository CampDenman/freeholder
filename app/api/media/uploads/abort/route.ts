// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { abortUpload } from "@/core/media/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(abortUpload);
