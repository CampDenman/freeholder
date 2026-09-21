// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: honest entry to the disposable shared playground.
import { notFound } from "next/navigation";
import { env } from "@/core/env";
import { getT } from "../i18n";
import { enterPlaygroundAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function PlaygroundPage() {
  if (env().FREEHOLDER_PLAYGROUND !== "1") notFound();
  const t = await getT();
  return <main className="mx-auto grid min-h-svh max-w-xl content-center gap-6 px-6 py-12">
    <h1 className="text-3xl font-bold tracking-tight">{t("playground.title")}</h1>
    <p className="text-ink-muted">{t("playground.description")}</p>
    <p className="rounded-lg border border-rule bg-surface p-4 text-sm">{t("playground.limits")}</p>
    <form action={enterPlaygroundAction}>
      <button className="rounded-lg bg-accent px-5 py-3 font-semibold text-on-accent" type="submit">{t("playground.enter")}</button>
    </form>
    <a className="text-sm text-accent underline" href="https://github.com/CampDenman/freeholder">{t("playground.source")}</a>
  </main>;
}
