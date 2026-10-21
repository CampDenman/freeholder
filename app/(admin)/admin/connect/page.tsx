// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { env } from "@/core/env";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { ConnectForm } from "./ConnectForm";
export const dynamic = "force-dynamic";
export default async function ConnectPage() {
  await requireStaffActor("apikeys", "manage");
  const t = await getT();
  return <div className="mx-auto grid max-w-2xl gap-6">
    <div><h1 className="text-xl font-bold tracking-tight">{t("connect.title")}</h1><p className="mt-2 text-sm text-ink-muted">{t("connect.intro")}</p></div>
    <ConnectForm endpoint={new URL("/api/mcp", env().APP_URL).href} labels={Object.fromEntries([
      "replitName", "lovableName", "otherName", "defaultName", "client", "name", "permissions", "read", "readHint", "website", "websiteHint", "health", "healthHint", "expiry", "create", "created", "secretHint", "endpoint", "token", "instructions", "replitInstructions", "lovableInstructions", "otherInstructions", "test", "testing", "tested", "failed", "copy", "copied", "download", "advanced", "verify", "manage", "prompt", "promptText", "config", "days30", "days90", "days365",
    ].map(key => [key, t(`connect.${key}`)]))} />
  </div>;
}
