// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: invoice list and tap-to-invoice (C10.17).
import { useCallback, useState } from "react";
import { ScrollView, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS, formatMoney } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { StaffScreen } from "@/lib/staff";
import { Button, Empty, Loading, Muted, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Invoice = { id: string; number: string | null; status: string; totalMinor: number; currency: string; contactId: string };
type Contacts = { rows: { id: string; name: string; email: string | null }[]; total: number };
type Draft = { invoice: { id: string } };

function minorFromAmount(value: string, currency: string, locale: string): number | null {
  const exponent = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 10 ** exponent);
}

export default function OwnerInvoices() {
  const { instance, brand, session, audience } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const network = useNetworkState();
  const [search, setSearch] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const staff = audience === "staff";
  const data = useScreenData<Invoice[]>({ screen: "ownerInvoices", service: "invoicing.list", caller, cache: memoryCache, params: { limit: 50 }, enabled: Boolean(session && staff) });
  const contacts = useScreenData<Contacts>({ screen: "ownerInvoices", service: "contacts.list", caller, cache: memoryCache, params: { search: search.trim() || undefined, limit: 8 }, enabled: Boolean(session && staff) });
  const create = useScreenWrite<Draft>({ screen: "ownerInvoices", service: "invoicing.createDraft", caller, online });
  const reloadList = data.reload;
  const reloadContacts = contacts.reload;
  useFocusEffect(useCallback(() => { reloadList(); reloadContacts(); }, [reloadList, reloadContacts]));
  if (!instance || !brand) return null;
  const field = { borderWidth: 1, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface, padding: 12, borderRadius: 8 };
  const createDraft = async () => {
    setNotice(null);
    const minor = minorFromAmount(amount, instance.currency, instance.locales.default);
    if (!contactId || !description.trim() || minor === null) { setNotice(t("app.ownerInvoice.empty")); return; }
    if (!online) { setNotice(t("app.ownerInvoice.offline")); return; }
    try {
      const draft = await create.execute({
        contactId,
        currency: instance.currency,
        idempotencyKey: `companion:${contactId}:${description.trim()}:${minor}`,
        lines: [{ description: description.trim(), quantityMicros: 1_000_000, unitAmountMinor: minor }],
        tax: { mode: "calculate", origin: { country: instance.country }, destination: { country: instance.country } },
      });
      setDescription(""); setAmount(""); setContactId(null);
      setNotice(t("app.ownerInvoice.drafted"));
      data.reload();
      router.push({ pathname: "/owner-invoice/[id]", params: { id: draft.invoice.id } });
    } catch { /* useScreenWrite records the error */ }
  };
  return <StaffScreen><Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.ownerInvoices.titleKey)}</Title>
    {data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={data.reload} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      <TextInput accessibilityLabel={t("app.ownerInvoices.search")} placeholder={t("app.ownerInvoices.search")} placeholderTextColor={brand.colors.inkMuted} value={search} onChangeText={setSearch} autoCapitalize="none" style={field} />
      {(contacts.value?.rows ?? []).map((contact) => <Row key={contact.id} brand={brand} title={contact.name} detail={contact.email ?? undefined} onPress={() => setContactId(contact.id)} />)}
      {contactId ? <Muted brand={brand}>{t("app.ownerInvoice.contact")}</Muted> : null}
      <TextInput accessibilityLabel={t("app.ownerInvoice.description")} placeholder={t("app.ownerInvoice.description")} placeholderTextColor={brand.colors.inkMuted} value={description} onChangeText={setDescription} style={field} />
      <TextInput accessibilityLabel={t("app.ownerInvoice.amount")} placeholder={t("app.ownerInvoice.amount")} placeholderTextColor={brand.colors.inkMuted} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={field} />
      {!online ? <Muted brand={brand}>{t("app.ownerInvoice.offline")}</Muted> : <Button brand={brand} label={t("app.ownerInvoice.create")} onPress={() => void createDraft()} />}
      {create.error ? <Problem brand={brand} message={create.error} /> : null}
      {notice ? <Muted brand={brand}>{notice}</Muted> : null}
      {!data.value?.length ? <Empty brand={brand} message={t(SCREENS.ownerInvoices.emptyKey)} /> : data.value.map((invoice) => <Row key={invoice.id} brand={brand} title={invoice.number ?? invoice.id} detail={`${formatMoney(invoice.totalMinor, invoice.currency, instance.locales.default)} · ${invoice.status}`} onPress={() => router.push({ pathname: "/owner-invoice/[id]", params: { id: invoice.id } })} />)}
      <Button brand={brand} label={t("app.retry")} onPress={data.reload} variant="quiet" />
    </ScrollView>}
  </Screen></StaffScreen>;
}
