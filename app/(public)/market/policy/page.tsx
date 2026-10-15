// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.28 (MASTER.md §44.9): what members may not sell on this site.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { marketPolicy } from "@/modules/members/policy";
import { getT } from "../../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.policy.title") };
}

export default async function MarketPolicyPage() {
  const [t, jar] = await Promise.all([getT(), cookies()]);
  const policy = await marketPolicy.call({}, await actorFromToken(jar.get(SESSION_COOKIE)?.value));
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">{t("members.policy.title")}</h1>
      <p className="text-ink-muted">{t("members.policy.intro")}</p>
      {policy.custom ? (
        <div className="whitespace-pre-line break-words">{policy.text}</div>
      ) : (
        <ul className="grid list-disc gap-2 ps-6">
          {(["weapons", "drugs", "counterfeit", "stolen", "recalled", "animals", "hazardous", "personalData", "exploitation", "adult"] as const).map((k) => (
            <li key={k}>{t(`members.policy.default.${k}`)}</li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-muted">{t("members.policy.law")}</p>
      <p className="text-sm text-ink-muted">{t("members.policy.version", { version: policy.version })}</p>
      <p><a className="underline" href="/market">{t("members.policy.backToMarket")}</a></p>
    </div>
  );
}
