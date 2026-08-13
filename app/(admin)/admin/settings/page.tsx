// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Editing the business after setup — the other half of §13. The wizard writes
// these once; this is where they live for the rest of the site's life.
import { redirect } from "next/navigation";
import { getLocale, getT } from "../../../i18n";
import { businessFormLabels, businessOptions } from "../../../setup/businessLabels";
import { requireStaffActor } from "../guard";
import { SettingsForm } from "./SettingsForm";
import { PasswordForm } from "./PasswordForm";
import { ApiKeysCard } from "./ApiKeysCard";
import { listApiKeys, listScopes } from "@/core/apikeys/service";
import { listDeliveries, listWebhooks } from "@/core/webhooks/service";
import { WebhooksCard } from "./WebhooksCard";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess, type Actor } from "@/core/service";
import { mailStatus } from "@/core/mail/service";
import { MailSettingsCard } from "./MailSettingsCard";

export const dynamic = "force-dynamic";


export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ mail?: string }>;
}) {
  const actor = await requireStaffActor("settings");
  const business = await currentBusiness();
  // Reachable only if setup was skipped somehow; the wizard is the way in.
  if (!business) redirect("/setup");

  const [t, locale, query] = await Promise.all([
    getT(),
    getLocale(),
    searchParams,
  ]);

  // Sensitive integration cards are fetched only when this stored role may
  // manage their modules, rather than rendered from calls that would refuse.
  const access = await loadAccess(actor, locale, {
    apiKeys: hasModuleAccess(actor, "apikeys", "manage"),
    webhooks: hasModuleAccess(actor, "webhooks", "manage"),
  });
  const mailAccess = hasModuleAccess(actor, "mail", "view")
    ? await loadMailAccess(actor, locale)
    : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("admin.settings.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("admin.settings.intro")}
        </p>
      </div>
      <SettingsForm
        readOnly={!hasModuleAccess(actor, "settings", "manage")}
        labels={{
          ...businessFormLabels(t),
          cardTitle: t("business.cardTitle"),
          submit: t("common.saveChanges"),
          pending: t("common.saving"),
          saved: t("admin.settings.saved"),
        }}
        options={businessOptions(locale, t, {
          currency: business.baseCurrency,
          timezone: business.timezone,
        })}
        values={{
          name: business.name,
          tagline: business.tagline ?? "",
          schemaType: business.schemaType,
          country: business.country,
          baseCurrency: business.baseCurrency,
          timezone: business.timezone,
          enabledLocales: business.enabledLocales,
          units: business.units,
          firstDayOfWeek: business.firstDayOfWeek,
        }}
      />

      {mailAccess ? (
        <MailSettingsCard
          {...mailAccess}
          canManage={hasModuleAccess(actor, "mail", "manage")}
          notice={mailNotice(query.mail, t)}
          labels={{
            title: t("mail.title"),
            intro: t("mail.intro"),
            route: t("mail.route"),
            transactional: t("mail.transactional"),
            transactionalIntro: t("mail.transactionalIntro"),
            bulk: t("mail.bulk"),
            bulkIntro: t("mail.bulkIntro"),
            provider: t("mail.provider"),
            delivers: t("mail.delivers"),
            notDelivering: t("mail.notDelivering"),
            configured: t("mail.configured"),
            incomplete: t("mail.incomplete"),
            notConfigured: t("mail.notConfigured"),
            missing: t("mail.missing"),
            connectGoogle: t("mail.connectGoogle"),
            connectMicrosoft: t("mail.connectMicrosoft"),
            register: t("mail.register"),
            senderEmail: t("mail.senderEmail"),
            displayName: t("mail.displayName"),
            providerIdentity: t("mail.providerIdentity"),
            providerIdentityHint: t("mail.providerIdentityHint"),
            webhook: t("mail.webhook"),
            feedbackReady: t("mail.feedbackReady"),
            feedbackMissing: t("mail.feedbackMissing"),
            senders: t("mail.senders"),
            noSenders: t("mail.noSenders"),
            default: t("mail.default"),
            chooseDefault: t("mail.chooseDefault"),
            verify: t("mail.verify"),
            recheck: t("mail.recheck"),
            pause: t("mail.pause"),
            reactivate: t("mail.reactivate"),
            test: t("mail.test"),
            verified: t("mail.verified"),
            pending: t("mail.pending"),
            failed: t("mail.failed"),
            active: t("mail.active"),
            paused: t("mail.paused"),
            needsAttention: t("mail.needsAttention"),
            needsReconnect: t("mail.needsReconnect"),
            revoked: t("mail.revoked"),
            permissionOff: t("mail.permissionOff"),
            lastChecked: t("mail.lastChecked"),
            recentDeliveries: t("mail.recentDeliveries"),
            noDeliveries: t("mail.noDeliveries"),
            recipient: t("mail.recipient"),
            subject: t("mail.subject"),
            status: t("mail.status"),
            attempts: t("mail.attempts"),
            when: t("mail.when"),
            suppressions: t("mail.suppressions"),
            suppressionIntro: t("mail.suppressionIntro"),
            noSuppressions: t("mail.noSuppressions"),
            reason: t("mail.reason"),
            release: t("mail.release"),
            releaseHint: t("mail.releaseHint"),
            confirmation: t("mail.confirmation"),
            readOnly: t("mail.readOnly"),
            actionDone: t("mail.actionDone"),
            pendingAction: t("mail.pendingAction"),
            deliveryStatuses: {
              queued: t("mail.delivery.queued"),
              submitted: t("mail.delivery.submitted"),
              delivered: t("mail.delivery.delivered"),
              bounced: t("mail.delivery.bounced"),
              complained: t("mail.delivery.complained"),
              failed: t("mail.delivery.failed"),
              suppressed: t("mail.delivery.suppressed"),
            },
            suppressionReasons: {
              hard_bounce: t("mail.suppression.hardBounce"),
              complaint: t("mail.suppression.complaint"),
              provider: t("mail.suppression.provider"),
              manual: t("mail.suppression.manual"),
            },
          }}
        />
      ) : null}

      {access.keys ? (
        <ApiKeysCard
          areas={access.keys.areas}
          keys={access.keys.rows}
          labels={{
            cardTitle: t("apikeys.title"),
            intro: t("apikeys.intro"),
            name: t("apikeys.name"),
            nameHint: t("apikeys.nameHint"),
            expiry: t("apikeys.expiry"),
            expiryHint: t("apikeys.expiryHint"),
            never: t("apikeys.never"),
            access: t("apikeys.access"),
            none: t("apikeys.none"),
            read: t("apikeys.read"),
            full: t("apikeys.full"),
            create: t("apikeys.create"),
            pending: t("common.saving"),
            created: t("apikeys.created"),
            createdHint: t("apikeys.createdHint"),
            existing: t("apikeys.existing"),
            empty: t("apikeys.empty"),
            neverUsed: t("apikeys.neverUsed"),
            lastUsed: t("apikeys.lastUsed"),
            expiresOn: t("apikeys.expiresOn"),
            revoke: t("apikeys.revoke"),
            revokeConfirm: t("apikeys.revokeConfirm"),
            publicOnly: t("apikeys.publicOnly"),
          }}
        />
      ) : null}

      {access.webhooks ? (
        <WebhooksCard
          hooks={access.webhooks.hooks}
          deliveries={access.webhooks.deliveries}
          labels={{
            cardTitle: t("webhooks.title"),
            intro: t("webhooks.intro"),
            name: t("webhooks.name"),
            nameHint: t("webhooks.nameHint"),
            url: t("webhooks.url"),
            urlHint: t("webhooks.urlHint"),
            events: t("webhooks.events"),
            eventsHint: t("webhooks.eventsHint"),
            create: t("webhooks.create"),
            pending: t("common.saving"),
            existing: t("webhooks.existing"),
            empty: t("webhooks.empty"),
            never: t("webhooks.never"),
            lastDelivery: t("webhooks.lastDelivery"),
            paused: t("webhooks.paused"),
            active: t("webhooks.active"),
            test: t("webhooks.test"),
            pause: t("webhooks.pause"),
            resume: t("webhooks.resume"),
            reveal: t("webhooks.reveal"),
            remove: t("webhooks.remove"),
            removeConfirm: t("webhooks.removeConfirm"),
            secretShown: t("webhooks.secretShown"),
            secretHint: t("webhooks.secretHint"),
            recent: t("webhooks.recent"),
            noDeliveries: t("webhooks.noDeliveries"),
          }}
        />
      ) : null}

      <PasswordForm
        labels={{
          cardTitle: t("settings.security"),
          intro: t("settings.securityIntro"),
          current: t("settings.currentPassword"),
          next: t("settings.newPassword"),
          nextHint: t("settings.newPasswordHelp"),
          submit: t("settings.changePassword"),
        }}
      />
    </div>
  );
}

function mailNotice(
  value: string | undefined,
  t: Awaited<ReturnType<typeof getT>>,
): { tone: "success" | "warning" | "danger"; text: string } | undefined {
  switch (value) {
    case "connected":
      return { tone: "success", text: t("mail.oauth.connected") };
    case "oauth_cancelled":
      return { tone: "warning", text: t("mail.oauth.cancelled") };
    case "oauth_conflict":
      return { tone: "danger", text: t("mail.oauth.conflict") };
    case "oauth_expired":
      return { tone: "warning", text: t("mail.oauth.expired") };
    case "oauth_incomplete":
    case "oauth_invalid_provider":
      return { tone: "danger", text: t("mail.oauth.incomplete") };
    case "oauth_failed":
      return { tone: "danger", text: t("mail.oauth.failed") };
    default:
      return undefined;
  }
}

async function loadMailAccess(actor: Actor, locale: string) {
  const status = await mailStatus.call({ limit: 25 }, actor);
  const exact = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return {
    configuration: status.configuration,
    senders: status.senders.map((sender) => ({
      ...sender,
      lastVerified: sender.lastVerifiedAt
        ? exact.format(sender.lastVerifiedAt)
        : null,
      lastVerifiedAt: undefined,
      createdAt: undefined,
    })),
    deliveries: status.deliveries.map((delivery) => ({
      id: delivery.id,
      provider: delivery.provider,
      recipient: delivery.recipient,
      subject: delivery.subject,
      status: delivery.status,
      attempts: delivery.attempts,
      detail: delivery.lastError,
      when: exact.format(delivery.createdAt),
    })),
    suppressions: status.suppressions.map((suppression) => ({
      email: suppression.email,
      reason: suppression.reason,
      provider: suppression.provider,
      detail: suppression.detail,
      when: exact.format(suppression.createdAt),
    })),
  };
}

/**
 * The key list and the scope areas the picker offers.
 *
 * `reads` is derived from each service's declared `kind`, so "read only" means
 * exactly this instance's query services — including any a module added
 * yesterday (§28). Nothing here is a second list to maintain.
 */
async function loadAccess(
  actor: Actor,
  locale: string,
  include: { apiKeys: boolean; webhooks: boolean },
) {
  const [areas, rows] = include.apiKeys
    ? await Promise.all([listScopes.call({}, actor), listApiKeys.call({}, actor)])
    : [null, null];
  const [hooks, deliveries] = include.webhooks
    ? await Promise.all([
        listWebhooks.call({}, actor),
        listDeliveries.call({ limit: 10 }, actor),
      ])
    : [null, null];
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const exact = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return {
    keys:
      areas && rows
        ? {
            areas: areas.map((area) => ({
              area: area.area,
              family: area.family,
              reads: area.services
                .filter((service) => service.kind === "query")
                .map((service) => service.name),
              total: area.services.length,
            })),
            rows: rows.map((row) => ({
              id: row.id,
              name: row.name,
              prefix: row.prefix,
              scopes: row.scopes,
              lastUsed: row.lastUsedAt ? when.format(row.lastUsedAt) : null,
              expires: row.expiresAt ? when.format(row.expiresAt) : null,
            })),
          }
        : null,
    webhooks:
      hooks && deliveries
        ? {
            hooks: hooks.map((hook) => ({
              id: hook.id,
              name: hook.name,
              url: hook.url,
              events: hook.events,
              status: hook.status,
              pausedReason: hook.pausedReason,
              lastDelivery: hook.lastDeliveryAt
                ? exact.format(hook.lastDeliveryAt)
                : null,
            })),
            deliveries: deliveries.map((delivery) => ({
              id: delivery.id,
              event: delivery.eventName,
              status: delivery.status,
              attempts: delivery.attempts,
              detail:
                delivery.error ??
                (delivery.responseStatus
                  ? String(delivery.responseStatus)
                  : ""),
              when: exact.format(delivery.createdAt),
            })),
          }
        : null,
  };
}
