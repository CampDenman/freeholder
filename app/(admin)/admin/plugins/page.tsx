// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { listInstalledPlugins, listPluginRegistries } from "@/core/plugins/service";
import { platformCompatibility } from "@/core/portability/service";
import { InstallPluginForm, PluginRowActions } from "./PluginForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PluginsPage() {
  const actor = await requireStaffActor("platform");
  const [t, plugins, registries, compatibility] = await Promise.all([
    getT(),
    listInstalledPlugins.call({}, actor),
    listPluginRegistries.call({}, actor),
    platformCompatibility.call({}, actor),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("plugins.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("plugins.intro")}</p>
        <p className="mt-2 font-mono text-xs text-ink-muted">
          {t("plugins.platform", { version: compatibility.version })}
        </p>
      </div>

      <Card>
        <CardHeader title={t("plugins.install")} />
        <CardBody>
          <InstallPluginForm
            labels={{
              path: t("plugins.path"),
              submit: t("plugins.install"),
              error: t("plugins.error"),
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("plugins.installed")} />
        <CardBody>
          {plugins.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("plugins.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {plugins.map((plugin) => (
                <li key={plugin.id} className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plugin.name}</span>
                    <Pill tone="neutral">{plugin.version}</Pill>
                    <Pill tone={plugin.status === "enabled" ? "success" : "neutral"}>
                      {t(`plugins.status.${plugin.status}`)}
                    </Pill>
                  </div>
                  <PluginRowActions
                    name={plugin.name}
                    status={plugin.status}
                    labels={{
                      enable: t("plugins.enable"),
                      disable: t("plugins.disable"),
                      uninstall: t("plugins.uninstall"),
                      keep: t("plugins.retention.keep"),
                      purge: t("plugins.retention.purge"),
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("plugins.registries")} />
        <CardBody>
          {registries.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("plugins.registriesEmpty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {registries.map((registry) => (
                <li key={registry.id} className="text-sm">
                  {registry.name} — {registry.url}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
