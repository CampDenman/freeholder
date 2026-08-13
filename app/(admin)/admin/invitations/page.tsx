// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Staff invitation administration (MASTER.md §43 C1.02).
import { getLocale, getT } from "../../../i18n";
import {
  listInvitationRoles,
  listInvitations,
} from "@/core/invitations/service";
import { hasModuleAccess } from "@/core/service";
import { requireStaffActor } from "../guard";
import { describeAction } from "../describeAction";
import { InvitationManager } from "./InvitationManager";

export const dynamic = "force-dynamic";

export default async function InvitationsPage() {
  const actor = await requireStaffActor("invitations");
  const [t, locale, invitations, roles] = await Promise.all([
    getT(),
    getLocale(),
    listInvitations.call({}, actor),
    listInvitationRoles.call({}, actor),
  ]);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const format = (value: Date | null) => (value ? when.format(value) : null);
  const actorLabel = (value: string) => {
    if (value.startsWith("agent:")) {
      return t("actor.agent", { name: value.slice("agent:".length) });
    }
    if (value.startsWith("user:")) return t("actor.staff");
    if (value === "system") return t("actor.system");
    return t("actor.visitor");
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("invitations.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("invitations.intro")}
        </p>
      </div>
      <InvitationManager
        roles={roles}
        invitations={invitations.map((invitation) => ({
          ...invitation,
          expiresAt: when.format(invitation.expiresAt),
          createdAt: when.format(invitation.createdAt),
          lastAttemptedAt: when.format(invitation.lastAttemptedAt),
          lastSentAt: format(invitation.lastSentAt),
          acceptedAt: format(invitation.acceptedAt),
          revokedAt: format(invitation.revokedAt),
          history: invitation.history.map((event) => ({
            ...event,
            action: describeAction(event.action),
            actor: actorLabel(event.actor),
            at: when.format(event.at),
          })),
        }))}
        canManage={hasModuleAccess(actor, "invitations", "manage")}
        labels={{
          createTitle: t("invitations.createTitle"),
          email: t("invitations.email"),
          role: t("invitations.role"),
          expiresIn: t("invitations.expiresIn"),
          days: t("invitations.days"),
          send: t("invitations.send"),
          sending: t("invitations.sending"),
          sent: t("invitations.sent"),
          logged: t("invitations.logged"),
          pendingTitle: t("invitations.pendingTitle"),
          historyTitle: t("invitations.historyTitle"),
          emptyPending: t("invitations.emptyPending"),
          emptyHistory: t("invitations.emptyHistory"),
          statusPending: t("invitations.status.pending"),
          statusAccepted: t("invitations.status.accepted"),
          statusRevoked: t("invitations.status.revoked"),
          statusExpired: t("invitations.status.expired"),
          expires: t("invitations.expires"),
          created: t("invitations.created"),
          delivery: t("invitations.delivery"),
          deliveredAt: t("invitations.deliveredAt"),
          notDelivered: t("invitations.notDelivered"),
          sentCount: t("invitations.sentCount"),
          resend: t("invitations.resend"),
          resending: t("invitations.resending"),
          revoke: t("invitations.revoke"),
          revokeConfirm: t("invitations.revokeConfirm"),
          revoked: t("invitations.revoked"),
          audit: t("invitations.audit"),
          readOnly: t("invitations.readOnly"),
          noRoles: t("invitations.noRoles"),
        }}
      />
    </div>
  );
}
