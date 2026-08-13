// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { mailWebhookRoute } from "@/core/mail/route";
import { processSesWebhook } from "@/core/mail/webhooks";

export const dynamic = "force-dynamic";
export const POST = mailWebhookRoute(processSesWebhook);
