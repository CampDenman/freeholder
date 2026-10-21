// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.26: the customer portal's own invoice room, in the native app.
import { useCallback } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SCREENS, resolveDeepLink, formatMoney } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Button, Empty, Loading, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Room = { key: string; failed: boolean; records: { id: string; title: string; status: string; href: string | null; amountMinor: number | null; currency: string | null }[] };

export default function Invoices() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const returnParams = useLocalSearchParams<{ instance?: string }>();
  const wrongInstance = Boolean(returnParams.instance && instance && !resolveDeepLink(`freeholder://invoices?instance=${encodeURIComponent(returnParams.instance)}`, { instanceUrl: instance.url }).ok);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const data = useScreenData<Room[]>({ screen: "invoices", service: "portal.myRecords", caller, cache: memoryCache, params: { section: "invoices", limit: 100 }, enabled: Boolean(session && !wrongInstance) });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const room = data.value?.find((entry) => entry.key === "invoices");
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.invoices.titleKey)}</Title>
    {wrongInstance ? <><Problem brand={brand} message={t("app.invoice.wrongInstance")} /><Button brand={brand} label={t("app.invoice.currentBusiness")} onPress={() => router.setParams({ instance: undefined })} variant="quiet" /></> : !session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error || room?.failed ? <Problem brand={brand} message={data.error ?? t("app.unavailable")} onRetry={reload} /> : !room?.records.length ? <Empty brand={brand} message={t(SCREENS.invoices.emptyKey)} /> : <ScrollView>
      <StalenessNotice brand={brand} label={data.staleness} />
      {room.records.map((record) => <Row key={record.id} brand={brand} title={record.title} detail={`${record.amountMinor !== null && record.currency ? formatMoney(record.amountMinor, record.currency, instance.locales.default) : ""} · ${t(`app.invoice.status.${record.status}`)}`} onPress={record.href ? () => router.push({ pathname: "/invoice/[id]", params: { id: record.id } }) : undefined} />)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
