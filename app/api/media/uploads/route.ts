// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { beginUpload, uploadStatus } from "@/core/media/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(beginUpload);
export const GET = serviceRoute(uploadStatus);
