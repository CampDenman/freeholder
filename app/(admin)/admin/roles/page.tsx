// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Named-role management (MASTER.md §43 C1.01).
import { getLocale, getT } from "../../../i18n";
import { hasModuleAccess } from "@/core/service";
import {
  listRoleModules,
  listRoles,
  listRoleUsers,
} from "@/core/roles/service";
import { requireStaffActor } from "../guard";
import { RoleManager } from "./RoleManager";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const actor = await requireStaffActor("roles");
  const [t, locale, roles, modules, accounts] = await Promise.all([
    getT(),
    getLocale(),
    listRoles.call({}, actor),
    listRoleModules.call({}, actor),
    listRoleUsers.call({}, actor),
  ]);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("roles.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("roles.intro")}
        </p>
      </div>
      <RoleManager
        roles={roles}
        modules={modules}
        accounts={accounts.map((account) => ({
          ...account,
          lastLogin: account.lastLoginAt ? when.format(account.lastLoginAt) : null,
        }))}
        canManage={hasModuleAccess(actor, "roles", "manage")}
        labels={{
          title: t("roles.title"),
          intro: t("roles.intro"),
          builtIn: t("roles.builtIn"),
          custom: t("roles.custom"),
          assigned: t("roles.assigned"),
          name: t("roles.name"),
          description: t("roles.description"),
          access: t("roles.access"),
          accessHint: t("roles.accessHint"),
          none: t("roles.none"),
          view: t("roles.view"),
          manage: t("roles.manage"),
          allModules: t("roles.allModules"),
          save: t("common.saveChanges"),
          saving: t("common.saving"),
          saved: t("roles.saved"),
          remove: t("common.delete"),
          removeConfirm: t("roles.removeConfirm"),
          createTitle: t("roles.createTitle"),
          create: t("roles.create"),
          accountsTitle: t("roles.accountsTitle"),
          account: t("roles.account"),
          role: t("roles.role"),
          lastLogin: t("roles.lastLogin"),
          never: t("roles.never"),
          assign: t("roles.assign"),
          readOnly: t("roles.readOnly"),
        }}
      />
    </div>
  );
}
