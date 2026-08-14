// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { paymentWebhookRoute } from "@/modules/invoicing/payment-webhook-route";

export const dynamic = "force-dynamic";
export const POST = paymentWebhookRoute("square");
