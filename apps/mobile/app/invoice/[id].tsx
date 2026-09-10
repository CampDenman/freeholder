// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.26: payments remain on the C5.25 web flow; the app only opens a URL.
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, ScrollView } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { formatMoney } from "@/lib/format";
import { useScreenData } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Invoice = { id: string; number: string; status: string; currency: string; dueAt: string | null; memo: string | null; requiredTaxLegend: string | null; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; paidMinor: number; canPay: boolean; paymentMode: "hosted" | "manual" | "unavailable"; lines: { id: string; description: string; totalMinor: number }[] };
const noCache = { async get() { return null; }, async set() {}, async delete() {} };

export default function InvoiceDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [problem, setProblem] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const data = useScreenData<Invoice>({ screen: "invoice", service: "invoicing.customerInvoice", caller, cache: memoryCache, params: { id }, enabled: Boolean(session && id) });
  const link = useScreenData<{ href: string | null }>({ screen: "invoice", service: "invoicing.customerInvoiceLink", caller, cache: noCache, params: { id }, enabled: Boolean(session && id && data.value?.canPay) });
  const reloadInvoice = data.reload;
  const reloadLink = link.reload;
  const reload = useCallback(() => { reloadInvoice(); reloadLink(); }, [reloadInvoice, reloadLink]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") reload(); });
    return () => listener.remove();
  }, [reload]);
  if (!instance || !brand) return null;
  const invoice = data.value;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const open = async () => {
    setProblem(null);
    if (!online || !link.value?.href) { setProblem(t("app.invoice.connect")); return; }
    try {
      const destination = new URL(link.value.href, instance.url);
      if (destination.origin !== new URL(instance.url).origin) throw new Error("wrong instance");
      await Linking.openURL(destination.href);
    } catch { setProblem(t("app.invoice.openFailed")); }
  };
  const money = (minor: number) => formatMoney(minor, invoice!.currency, instance.locales.default);
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.invoice.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !invoice ? <Empty brand={brand} message={t(SCREENS.invoice.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      <Body brand={brand}>{invoice.number}</Body>
      <Body brand={brand}>{t(`app.invoice.status.${invoice.status}`)}</Body>
      {invoice.dueAt ? <Muted brand={brand}>{t("app.invoice.due")}: {new Intl.DateTimeFormat(instance.locales.default, { dateStyle: "long", timeZone: instance.timezone }).format(new Date(invoice.dueAt))}</Muted> : null}
      {invoice.lines.map((line) => <Row key={line.id} brand={brand} title={line.description} detail={money(line.totalMinor)} />)}
      {([ ["subtotal", invoice.subtotalMinor], ["discount", invoice.discountMinor], ["shipping", invoice.shippingMinor], ["tax", invoice.taxMinor] ] as const).map(([key, amount]) => <Body key={key} brand={brand}>{t(`app.invoice.${key}`)}: {money(amount)}</Body>)}
      <Body brand={brand}>{t("app.invoice.total")}: {money(invoice.totalMinor)}</Body>
      <Body brand={brand}>{t("app.invoice.paid")}: {money(invoice.paidMinor)}</Body>
      <Body brand={brand}>{t("app.invoice.balance")}: {money(invoice.totalMinor - invoice.paidMinor)}</Body>
      {invoice.requiredTaxLegend ? <Muted brand={brand}>{invoice.requiredTaxLegend}</Muted> : null}
      {invoice.memo ? <Body brand={brand}>{invoice.memo}</Body> : null}
      {problem || link.error ? <Problem brand={brand} message={problem ?? link.error!} onRetry={reload} /> : null}
      {invoice.canPay ? invoice.paymentMode === "unavailable" ? <Muted brand={brand}>{t("app.invoice.unavailable")}</Muted> : link.loading ? <Loading brand={brand} /> : link.value?.href && online ? <><Button brand={brand} label={t(invoice.paymentMode === "manual" ? "app.invoice.instructions" : "app.invoice.pay")} onPress={() => void open()} /><Muted brand={brand}>{t("app.invoice.webHint")}</Muted></> : <Muted brand={brand}>{t("app.invoice.connect")}</Muted> : <Muted brand={brand}>{t("app.invoice.closed")}</Muted>}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
