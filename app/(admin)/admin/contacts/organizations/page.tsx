// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { Buildings, MagnifyingGlass, Plus } from "@phosphor-icons/react/dist/ssr";
import { listOrganizations } from "@/core/contacts/organizations";
import { Button, Card, Input } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { hasModuleAccess } from "@/core/service";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("contacts");
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const search = first("search");
  const offset = Math.max(0, Number(first("offset")) || 0);
  const [t, result] = await Promise.all([
    getT(),
    listOrganizations.call(
      { search: search || undefined, limit: PAGE_SIZE, offset },
      actor,
    ),
  ]);
  const canManage = hasModuleAccess(actor, "contacts", "manage");
  const href = (next: number) => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (next > 0) query.set("offset", String(next));
    return `/admin/contacts/organizations?${query}`;
  };
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <a href="/admin/contacts" className="text-sm text-ink-muted">
            {t("contacts.detail.back")}
          </a>
          <h1 className="mt-2 text-xl font-bold tracking-tight">
            {t("contacts.organizations.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("contacts.organizations.intro")}
          </p>
        </div>
        {canManage ? (
          <a
            href="/admin/contacts/organizations/new"
            className="ms-auto inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
          >
            <Plus size={15} weight="bold" />
            {t("contacts.organizations.new")}
          </a>
        ) : null}
      </div>
      <form method="get" className="flex items-end gap-3 rounded-lg border border-rule bg-surface p-3">
        <div className="grid flex-1 gap-1.5">
          <label htmlFor="search" className="font-mono text-xs text-ink-muted">
            {t("contacts.organizations.search")}
          </label>
          <Input id="search" name="search" type="search" defaultValue={search} />
        </div>
        <Button type="submit" variant="quiet">
          <MagnifyingGlass size={15} weight="bold" />
          {t("common.search")}
        </Button>
      </form>
      <Card>
        {result.total === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <Buildings size={28} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">
              {t("contacts.organizations.empty")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule bg-surface-muted">
                  <th className="px-4 py-2.5 text-start font-mono text-xs text-ink-muted">
                    {t("contacts.organizations.name")}
                  </th>
                  <th className="px-4 py-2.5 text-start font-mono text-xs text-ink-muted">
                    {t("contacts.organizations.domain")}
                  </th>
                  <th className="px-4 py-2.5 text-start font-mono text-xs text-ink-muted">
                    {t("contacts.organizations.members")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((organization) => (
                  <tr key={organization.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2.5">
                      <a
                        href={`/admin/contacts/organizations/${organization.id}`}
                        className="font-medium underline decoration-rule underline-offset-2"
                      >
                        {organization.name}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {organization.domain ?? t("common.emptyValue")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-muted">
                      {organization.memberCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {result.total > PAGE_SIZE ? (
        <div className="flex justify-end gap-2 text-sm">
          {offset > 0 ? (
            <a className="rounded-md border border-rule px-3 py-1.5" href={href(Math.max(0, offset - PAGE_SIZE))}>
              {t("common.previous")}
            </a>
          ) : null}
          {offset + PAGE_SIZE < result.total ? (
            <a className="rounded-md border border-rule px-3 py-1.5" href={href(offset + PAGE_SIZE)}>
              {t("common.next")}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
