// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { beginUpload, uploadStatus } from "@/core/media/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(beginUpload);
export const GET = serviceRoute(uploadStatus);
