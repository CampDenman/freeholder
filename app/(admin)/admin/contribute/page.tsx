// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner compose + history, and hub inbox (C1.31).
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { hasModuleAccess } from "@/core/service";
import {
  getContributeSettings,
  listContributions,
} from "@/core/contribute/service";
import { SettingsForm, SubmitForm } from "./ContributeForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ContributePage() {
  const actor = await requireStaffActor("contribute");
  const canManage = hasModuleAccess(actor, "contribute", "manage");
  const [t, settings, items] = await Promise.all([
    getT(),
    getContributeSettings.call({}, actor),
    listContributions.call({ limit: 50 }, actor),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("contribute.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("contribute.intro")}
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader title={t("contribute.compose")} />
          <CardBody>
            <SubmitForm
              labels={{
                kind: t("contribute.kind"),
                kinds: [
                  { value: "bug", label: t("contribute.kind.bug") },
                  { value: "feature", label: t("contribute.kind.feature") },
                  { value: "patch", label: t("contribute.kind.patch") },
                  { value: "docs", label: t("contribute.kind.docs") },
                  { value: "question", label: t("contribute.kind.question") },
                ],
                title: t("contribute.field.title"),
                body: t("contribute.field.body"),
                email: t("contribute.field.email"),
                name: t("contribute.field.name"),
                externalUrl: t("contribute.field.externalUrl"),
                dco: t("contribute.field.dco"),
                dcoSigner: t("contribute.field.dcoSigner"),
                submit: t("contribute.submit"),
                error: t("contribute.error"),
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("contribute.history")} />
        <CardBody>
          {items.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("contribute.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/admin/contribute/${item.id}`}
                    className="flex flex-wrap items-center gap-2 text-sm text-ink"
                  >
                    <Pill tone="neutral">{t(`contribute.kind.${item.kind}`)}</Pill>
                    <span className="font-medium">{item.title}</span>
                    <span className="text-ink-muted">{t(`contribute.status.${item.status}`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("contribute.settings")} />
          <CardBody>
            <p className="mb-4 max-w-prose text-sm text-ink-muted">
              {t("contribute.settings.intro")}
            </p>
            <SettingsForm
              hubEnabled={settings.hubEnabled}
              hubUrl={settings.hubUrl}
              labels={{
                hubEnabled: t("contribute.settings.hubEnabled"),
                hubUrl: t("contribute.settings.hubUrl"),
                save: t("contribute.settings.save"),
              }}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
