// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: moderate reviews (C10.17).
import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { StaffScreen } from "@/lib/staff";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

function RowBlock({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: 8 }}>{children}</View>;
}

type Review = { id: string; rating: number; title: string | null; body: string; status: string; displayName: string | null };

export default function Reviews() {
  const { instance, brand, session, audience } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const data = useScreenData<Review[]>({ screen: "reviews", service: "reviews.list", caller, cache: memoryCache, params: { limit: 50 }, enabled: Boolean(session && audience === "staff") });
  const moderate = useScreenWrite<Review>({ screen: "reviews", service: "reviews.moderate", caller, online });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const decide = (id: string, status: "approved" | "hidden" | "rejected") => {
    if (!online) return;
    void moderate.execute({ id, status }).then(() => data.reload()).catch(() => {});
  };
  return <StaffScreen><Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.reviews.titleKey)}</Title>
    {data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !data.value?.length ? <Empty brand={brand} message={t(SCREENS.reviews.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      {!online ? <Muted brand={brand}>{t("app.reviews.offline")}</Muted> : null}
      {moderate.error ? <Problem brand={brand} message={moderate.error} /> : null}
      {data.value.map((review) => <RowBlock key={review.id}>
        <Body brand={brand}>{review.displayName ?? review.status} · {review.rating}</Body>
        {review.title ? <Body brand={brand}>{review.title}</Body> : null}
        <Muted brand={brand}>{review.body}</Muted>
        {online && review.status === "pending" ? <>
          <Button brand={brand} label={t("app.reviews.approve")} onPress={() => decide(review.id, "approved")} />
          <Button brand={brand} label={t("app.reviews.hide")} onPress={() => decide(review.id, "hidden")} variant="quiet" />
          <Button brand={brand} label={t("app.reviews.reject")} onPress={() => decide(review.id, "rejected")} variant="quiet" />
        </> : <Muted brand={brand}>{review.status}</Muted>}
      </RowBlock>)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen></StaffScreen>;
}
