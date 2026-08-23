// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { smsWebhookRoute } from "@/core/messaging/webhook-route";

export const dynamic = "force-dynamic";
export const POST = smsWebhookRoute("twilio");
