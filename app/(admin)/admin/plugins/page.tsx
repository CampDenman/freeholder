// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import {
  listInstalledPlugins,
  listPluginCatalog,
  listPluginRegistries,
} from "@/core/plugins/service";
import { platformCompatibility } from "@/core/portability/service";
import { listPublisherKeys } from "@/core/plugins/publisher-keys";
import { signatureKeyId } from "@/core/plugins/integrity";
import { AddRegistryForm, CacheRegistryForm, InstallPluginForm, PluginRowActions, RegistryPublisherForm, RevokePublisherForm, TrustPublisherForm } from "./PluginForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PluginsPage() {
  const actor = await requireStaffActor("platform");
  const [t, plugins, registries, catalog, compatibility, publisherKeys] = await Promise.all([
    getT(),
    listInstalledPlugins.call({}, actor),
    listPluginRegistries.call({}, actor),
    listPluginCatalog.call({}, actor),
    platformCompatibility.call({}, actor),
    listPublisherKeys.call({}, actor),
  ]);
  const isOwner = actor.kind === "user" && actor.role === "owner";
  const canChangeTrust = isOwner && Boolean(actor.security?.stepUpValid);
  const activeKeys = publisherKeys.filter(key => !key.revokedAt);

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
              signature: t("plugins.signature"),
              signatureHint: t("plugins.signatureHint"),
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
                <li key={plugin.id} data-plugin-name={plugin.name} className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plugin.name}</span>
                    <Pill tone="neutral">{plugin.version}</Pill>
                    <Pill tone={plugin.status === "enabled" ? "success" : "neutral"}>
                      {t(`plugins.status.${plugin.status}`)}
                    </Pill>
                  </div>
                  <p className="text-xs text-ink-muted">{plugin.signature
                    ? t("plugins.trust.signedBy", { publisher: publisherKeys.find(key => key.keyId === signatureKeyId(plugin.signature!))?.publisher ?? t("plugins.trust.unverified") })
                    : t("plugins.trust.unverified")}</p>
                  <PluginRowActions
                    name={plugin.name}
                    status={plugin.status}
                    source={plugin.source}
                    previousVersion={plugin.previousVersion}
                    labels={{
                      enable: t("plugins.enable"),
                      disable: t("plugins.disable"),
                      uninstall: t("plugins.uninstall"),
                      keep: t("plugins.retention.keep"),
                      purge: t("plugins.retention.purge"),
                      update: t("plugins.update"),
                      path: t("plugins.updatePath"),
                      rollback: t("plugins.rollback"),
                      rollbackUnavailable: t("plugins.rollbackUnavailable"),
                      error: t("plugins.error"),
                      signature: t("plugins.signature"),
                    }}
                  />
                  {plugin.previousVersion ? (
                    <p className="text-xs text-ink-muted">
                      {t("plugins.previous", { version: plugin.previousVersion })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("plugins.trust.title")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("plugins.trust.intro")}</p>
          {isOwner && !canChangeTrust ? <a className="text-sm font-medium text-accent underline" href="/security/verify?returnTo=/admin/plugins">{t("plugins.trust.verify")}</a> : null}
          <ul className="grid list-none gap-4 p-0">
            {publisherKeys.map(key => <li key={key.keyId} data-publisher-key-id={key.keyId} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{key.publisher}</span><Pill tone={key.revokedAt ? "neutral" : "success"}>{t(key.revokedAt ? "plugins.trust.revoked" : "plugins.trust.active")}</Pill></div>
              <code dir="ltr" className="break-all text-xs text-ink-muted">{key.keyId}</code>
              {isOwner ? <RevokePublisherForm keyId={key.keyId} revoked={Boolean(key.revokedAt)} canChangeTrust={canChangeTrust} labels={{ submit: t("plugins.trust.revoke"), confirmation: t("plugins.trust.revokeConfirmation"), saved: t("plugins.trust.revoked") }} /> : null}
            </li>)}
          </ul>
          {isOwner ? <TrustPublisherForm canChangeTrust={canChangeTrust} publisherNames={[...new Set(publisherKeys.map(key => key.publisher))]} labels={{
            publisher: t("plugins.trust.publisher"), publisherHint: t("plugins.trust.publisherHint"), publicKey: t("plugins.trust.publicKey"),
            fingerprint: t("plugins.trust.fingerprint"), fingerprintHint: t("plugins.trust.fingerprintHint"),
            confirmation: t("plugins.trust.confirmation"), submit: t("plugins.trust.submit"), saved: t("plugins.trust.saved"),
          }} /> : null}
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
                <li key={registry.id} data-plugin-registry-id={registry.id} className="text-sm">
                  {registry.name} — {registry.url}
                  {isOwner ? <RegistryPublisherForm id={registry.id} keyId={registry.publisherKeyId} publisherKeys={activeKeys} canChangeTrust={canChangeTrust} labels={{ key: t("plugins.trust.registryKey"), choose: t("plugins.trust.chooseKey"), submit: t("plugins.trust.pin"), saved: t("plugins.trust.saved") }} /> : null}
                  <CacheRegistryForm id={registry.id} url={registry.url} trusted={activeKeys.some(key => key.keyId === registry.publisherKeyId)} labels={{ index: t("plugins.catalogIndex"), signature: t("plugins.signature"), submit: t("plugins.cacheCatalog"), saved: t("plugins.catalogSaved") }} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <AddRegistryForm
              publisherKeys={activeKeys}
              canChangeTrust={canChangeTrust}
              labels={{
                name: t("plugins.registryName"),
                url: t("plugins.registryUrl"),
                tier: t("plugins.registryTier"),
                submit: t("plugins.addRegistry"),
                error: t("plugins.error"),
                verified: t("plugins.tier.verified"),
                community: t("plugins.tier.community"),
                private: t("plugins.tier.private"),
                local: t("plugins.tier.local"),
                publisherKey: t("plugins.trust.registryKey"),
                chooseKey: t("plugins.trust.chooseKey"),
              }}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("plugins.catalog")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("plugins.catalogIntro")}</p>
          {catalog.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("plugins.catalogEmpty")}</p>
          ) : (
            <ul className="mt-2 grid list-none gap-2 p-0">
              {catalog.map((plugin) => (
                <li key={`${plugin.name}@${plugin.version}`} data-catalog-plugin={plugin.name} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{plugin.name}</span>
                  <Pill tone="neutral">{plugin.version}</Pill>
                  <Pill tone="neutral">{t(`plugins.tier.${plugin.tier}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
