// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: inbox (C10.17).
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

type Thread = { id: string; subject: string | null; contactName: string | null; status: string; unread: boolean; updatedAt: string };

export default function Inbox() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const data = useScreenData<Thread[]>({ screen: "inbox", service: "conversations.list", caller, cache: memoryCache, params: { limit: 50 }, enabled: Boolean(session) });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.inbox.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !data.value?.length ? <Empty brand={brand} message={t(SCREENS.inbox.emptyKey)} /> : <ScrollView>
      <StalenessNotice brand={brand} label={data.staleness} />
      {data.value.map((thread) => <Row key={thread.id} brand={brand} title={thread.contactName ?? thread.subject ?? t("app.inboxThread.title")} detail={thread.unread ? thread.status : new Intl.DateTimeFormat(instance.locales.default, { dateStyle: "medium", timeStyle: "short", timeZone: instance.timezone }).format(new Date(thread.updatedAt))} onPress={() => router.push({ pathname: "/inbox-thread/[id]", params: { id: thread.id } })} />)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
