// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: critical notifications (C10.17).
import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

type Alert = { id: string; title: string; body: string; priority: string; readAt: string | null; lastOccurredAt: string };

export default function Alerts() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const data = useScreenData<Alert[]>({ screen: "alerts", service: "notifications.list", caller, cache: memoryCache, params: { state: "critical", limit: 50 }, enabled: Boolean(session) });
  const markRead = useScreenWrite<{ id: string }>({ screen: "alerts", service: "notifications.markRead", caller, online });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.alerts.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !data.value?.length ? <Empty brand={brand} message={t(SCREENS.alerts.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      {markRead.error ? <Problem brand={brand} message={markRead.error} /> : null}
      {data.value.map((item) => <View key={item.id} style={{ gap: 8 }}>
        <Body brand={brand}>{item.title}</Body>
        <Muted brand={brand}>{item.body}</Muted>
        {item.readAt ? null : online ? <Button brand={brand} label={t("app.alerts.markRead")} onPress={() => void markRead.execute({ id: item.id, read: true }).then(() => data.reload()).catch(() => {})} variant="quiet" /> : null}
      </View>)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
