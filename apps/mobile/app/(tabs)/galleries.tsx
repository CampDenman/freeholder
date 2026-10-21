// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.27: the customer portal's own galleries room, in the native app.
import { useCallback } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Button, Empty, Loading, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Room = { key: string; failed: boolean; records: { id: string; title: string; href: string | null; at: string | null }[] };

function gallerySlug(href: string | null): string | null {
  if (!href) return null;
  const parts = href.split("/").filter(Boolean);
  const index = parts.lastIndexOf("g");
  const slug = index >= 0 ? parts[index + 1] : undefined;
  if (!slug) return null;
  try { return decodeURIComponent(slug); } catch { return slug; }
}

export default function Galleries() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const data = useScreenData<Room[]>({ screen: "galleries", service: "portal.myRecords", caller, cache: memoryCache, params: { section: "galleries", limit: 100 }, enabled: Boolean(session) });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const room = data.value?.find((entry) => entry.key === "galleries");
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.galleries.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error || room?.failed ? <Problem brand={brand} message={data.error ?? t("app.unavailable")} onRetry={reload} /> : !room?.records.length ? <Empty brand={brand} message={t(SCREENS.galleries.emptyKey)} /> : <ScrollView>
      <StalenessNotice brand={brand} label={data.staleness} />
      {room.records.map((record) => {
        const slug = gallerySlug(record.href);
        const when = record.at ? new Intl.DateTimeFormat(instance.locales.default, { dateStyle: "medium", timeZone: instance.timezone }).format(new Date(record.at)) : undefined;
        return <Row key={record.id} brand={brand} title={record.title} detail={when} onPress={slug ? () => router.push({ pathname: "/gallery/[slug]", params: { slug } }) : undefined} />;
      })}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
