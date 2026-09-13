// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: one invoice (C10.17).
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS, formatMoney } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { StaffScreen } from "@/lib/staff";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Bundle = { invoice: { id: string; number: string | null; status: string; currency: string; totalMinor: number; memo: string | null }; lines: { id: string; description: string; totalMinor: number }[] };

export default function OwnerInvoice() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { instance, brand, session, audience } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [notice, setNotice] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const data = useScreenData<Bundle>({ screen: "ownerInvoice", service: "invoicing.get", caller, cache: memoryCache, params: { id }, enabled: Boolean(session && audience === "staff" && id) });
  const issue = useScreenWrite<Bundle>({ screen: "ownerInvoice", service: "invoicing.issue", caller, online });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const invoice = data.value?.invoice;
  const send = async () => {
    if (!invoice || !online) return;
    setNotice(null);
    try {
      await issue.execute({ id: invoice.id });
      setNotice(t("app.ownerInvoice.issued"));
      data.reload();
    } catch { /* recorded */ }
  };
  return <StaffScreen><Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.ownerInvoice.titleKey)}</Title>
    {data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !invoice ? <Empty brand={brand} message={t(SCREENS.ownerInvoice.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      <Body brand={brand}>{invoice.number ?? invoice.id}</Body>
      <Body brand={brand}>{invoice.status}</Body>
      {(data.value?.lines ?? []).map((line) => <Row key={line.id} brand={brand} title={line.description} detail={formatMoney(line.totalMinor, invoice.currency, instance.locales.default)} />)}
      <Body brand={brand}>{formatMoney(invoice.totalMinor, invoice.currency, instance.locales.default)}</Body>
      {invoice.memo ? <Muted brand={brand}>{invoice.memo}</Muted> : null}
      {notice ? <Body brand={brand}>{notice}</Body> : null}
      {issue.error ? <Problem brand={brand} message={issue.error} /> : null}
      {invoice.status === "draft" ? online ? <Button brand={brand} label={t("app.ownerInvoice.issue")} onPress={() => void send()} /> : <Muted brand={brand}>{t("app.ownerInvoice.offline")}</Muted> : null}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen></StaffScreen>;
}
