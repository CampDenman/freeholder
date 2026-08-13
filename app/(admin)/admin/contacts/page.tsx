// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The spine, made browsable (MASTER.md §2 principle 3, §4.1).
//
// Search and filtering are a GET form reading searchParams, not client state:
// it works before JavaScript loads, the back button behaves, and a filtered
// view is a URL somebody can bookmark or send to their bookkeeper.
import { MagnifyingGlass, Plus, UserPlus } from "@phosphor-icons/react/dist/ssr";
import { listContacts, listContactTags } from "@/core/contacts/service";
import { formatDateTime } from "@/core/i18n";
import { Button, Card, Input, Pill, Select, cx } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { CONTACT_STAGES } from "./contactLabels";
import { requireStaffActor } from "../guard";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const STAGE_TONE = {
  lead: "neutral",
  prospect: "accent",
  customer: "success",
  repeat: "success",
} as const;

function pageHref(params: Record<string, string>, offset: number): string {
  const query = new URLSearchParams(params);
  if (offset > 0) query.set("offset", String(offset));
  else query.delete("offset");
  const qs = query.toString();
  return qs ? `/admin/contacts?${qs}` : "/admin/contacts";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("contacts");
  const params = await searchParams;

  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const search = one("search");
  const stage = one("stage");
  const tag = one("tag");
  const offset = Math.max(0, Number(one("offset")) || 0);

  const [business, t, result, tags] = await Promise.all([
    currentBusiness(),
    getT(),
    listContacts.call(
      {
        search: search || undefined,
        lifecycleStage: stage || undefined,
        tag: tag || undefined,
        limit: PAGE_SIZE,
        offset,
      },
      actor,
    ),
    listContactTags.call({}, actor),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const filters: Record<string, string> = {};
  if (search) filters.search = search;
  if (stage) filters.stage = stage;
  if (tag) filters.tag = tag;
  const filtered = Boolean(search || stage || tag);
  const canManage = hasModuleAccess(actor, "contacts", "manage");
  const stageOptions = [
    { value: "", label: t("contacts.allStages") },
    ...CONTACT_STAGES.map((value) => ({
      value,
      label: t(`contacts.stagePlural.${value}`),
    })),
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("contacts.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{t("contacts.intro")}</p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <a href="/admin/contacts/privacy" className="text-sm text-ink-muted">
            {t("privacy.title")}
          </a>
          <a href="/admin/contacts/duplicates" className="text-sm text-ink-muted">
            {t("contacts.duplicates.title")}
          </a>
          <a href="/admin/contacts/organizations" className="text-sm text-ink-muted">
            {t("contacts.organizations.title")}
          </a>
          {canManage ? (
            <a href="/admin/contacts/fields" className="text-sm text-ink-muted">
              {t("contacts.fields.title")}
            </a>
          ) : null}
          {canManage ? (
            <a
              href="/admin/contacts/new"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]"
            >
              <Plus size={15} weight="bold" />
              {t("contacts.new")}
            </a>
          ) : null}
        </div>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-surface p-3"
      >
        <div className="grid min-w-52 flex-1 gap-1.5">
          <label
            htmlFor="search"
            className="font-mono text-xs font-medium text-ink-muted"
          >
            {t("contacts.searchLabel")}
          </label>
          <Input
            id="search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder={t("contacts.searchPlaceholder")}
          />
        </div>
        <div className="grid gap-1.5">
          <label
            htmlFor="stage"
            className="font-mono text-xs font-medium text-ink-muted"
          >
            {t("contacts.stageLabel")}
          </label>
          <Select id="stage" name="stage" defaultValue={stage}>
            {stageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        {tags.length > 0 ? (
          <div className="grid gap-1.5">
            <label
              htmlFor="tag"
              className="font-mono text-xs font-medium text-ink-muted"
            >
              {t("contacts.tagLabel")}
            </label>
            <Select id="tag" name="tag" defaultValue={tag}>
              <option value="">{t("contacts.allTags")}</option>
              {tags.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <Button type="submit" variant="quiet">
          <MagnifyingGlass size={15} weight="bold" />
          {t("common.search")}
        </Button>
        {filtered ? (
          <a href="/admin/contacts" className="py-2 text-sm text-ink-muted">
            {t("common.clear")}
          </a>
        ) : null}
      </form>

      <Card>
        {result.total === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <UserPlus size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">
              {filtered ? t("contacts.emptyFiltered") : t("contacts.empty")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule bg-surface-muted text-start">
                  <th className="px-4 py-2.5 text-start font-mono text-xs font-medium text-ink-muted">
                    {t("contacts.column.name")}
                  </th>
                  <th className="px-4 py-2.5 text-start font-mono text-xs font-medium text-ink-muted">
                    {t("contacts.column.email")}
                  </th>
                  <th className="px-4 py-2.5 text-start font-mono text-xs font-medium text-ink-muted">
                    {t("contacts.column.stage")}
                  </th>
                  <th className="px-4 py-2.5 text-start font-mono text-xs font-medium text-ink-muted">
                    {t("contacts.column.added")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((contact) => (
                  <tr key={contact.id} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-2.5">
                      <a
                        href={`/admin/contacts/${contact.id}`}
                        className="font-medium underline decoration-rule underline-offset-2"
                      >
                        {contact.name}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {contact.email ?? t("common.emptyValue")}
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill tone={STAGE_TONE[contact.lifecycleStage]}>
                        {t(`contacts.stage.${contact.lifecycleStage}`)}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted tabular-nums">
                      {formatDateTime(contact.createdAt, timezone, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {result.total > PAGE_SIZE ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-muted tabular-nums">
            {t("contacts.paging", {
              from: offset + 1,
              to: Math.min(offset + PAGE_SIZE, result.total),
              total: result.total,
            })}
          </span>
          <div className="ms-auto flex gap-2">
            <a
              href={pageHref(filters, Math.max(0, offset - PAGE_SIZE))}
              aria-disabled={offset === 0}
              className={cx(
                "rounded-md border border-rule px-3 py-1.5",
                offset === 0 && "pointer-events-none opacity-45",
              )}
            >
              {t("common.previous")}
            </a>
            <a
              href={pageHref(filters, offset + PAGE_SIZE)}
              aria-disabled={offset + PAGE_SIZE >= result.total}
              className={cx(
                "rounded-md border border-rule px-3 py-1.5",
                offset + PAGE_SIZE >= result.total &&
                  "pointer-events-none opacity-45",
              )}
            >
              {t("common.next")}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
