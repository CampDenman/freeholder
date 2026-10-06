// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { redirect } from "next/navigation";
import { setupState } from "@/core/settings/service";
import { twoFactorStatus } from "@/core/auth/two-factor";
import { getT } from "../../i18n";
import { SecurityControls } from "../../(admin)/security/SecurityControls";
import { securityLabels } from "../../(admin)/security/labels";
import { setupOwner } from "../access";
import { Steps } from "../Steps";

export const dynamic = "force-dynamic";
export default async function SetupSecurityPage() {
  const state = await setupState.call({}, { kind: "anonymous" });
  if (!state.hasOwner) redirect("/setup");
  if (state.completed) redirect("/security");
  const actor = await setupOwner(false);
  const [status, t] = await Promise.all([twoFactorStatus.call({}, actor), getT()]);
  return <>
    <Steps current={1} />
    <h1 className="text-2xl font-bold tracking-tight">{t("setup.security.title")}</h1>
    <p className="mt-2 mb-8 text-ink-muted">{t("setup.security.intro")}</p>
    <SecurityControls
      status={{ required: status.required, stepUpValid: status.stepUpValid, totp: Boolean(status.totp), webauthn: status.webauthn, recoveryCodesRemaining: status.recoveryCodesRemaining, sessions: [], loginActivity: [] }}
      labels={securityLabels(t, status.recoveryCodesRemaining)}
      setup={{ continueLabel: t("setup.security.continue"), recoverySaved: t("setup.security.recoverySaved") }}
    />
  </>;
}
