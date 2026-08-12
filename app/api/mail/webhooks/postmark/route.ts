// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { mailWebhookRoute } from "@/core/mail/route";
import { processPostmarkWebhook } from "@/core/mail/webhooks";

export const dynamic = "force-dynamic";
export const POST = mailWebhookRoute(processPostmarkWebhook);
