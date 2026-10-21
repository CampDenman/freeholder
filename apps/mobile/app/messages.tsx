// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own threads (C10.28).
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

type Thread = { id: string; subject: string | null; threadKey: string | null; status: string; lastInboundAt: string | null; lastOutboundAt: string | null };

export default function Messages() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const profile = useScreenData<{ contactId: string }>({ screen: "messages", service: "portal.myProfile", caller, cache: memoryCache, enabled: Boolean(session) });
  const contactId = profile.value?.contactId;
  const data = useScreenData<Thread[]>({ screen: "messages", service: "conversations.list", caller, cache: memoryCache, params: { contactId, limit: 50 }, enabled: Boolean(session && contactId) });
  const reloadProfile = profile.reload;
  const reloadThreads = data.reload;
  useFocusEffect(useCallback(() => { reloadProfile(); reloadThreads(); }, [reloadProfile, reloadThreads]));
  if (!instance || !brand) return null;
  const reload = () => { profile.reload(); data.reload(); };
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.messages.titleKey)}</Title>
    {!session ? <SignIn /> : profile.loading || data.loading ? <Loading brand={brand} /> : profile.error || data.error ? <Problem brand={brand} message={profile.error ?? data.error!} onRetry={reload} /> : !data.value?.length ? <Empty brand={brand} message={t(SCREENS.messages.emptyKey)} /> : <ScrollView>
      <StalenessNotice brand={brand} label={data.staleness} />
      {data.value.map((thread) => {
        const when = thread.lastInboundAt ?? thread.lastOutboundAt;
        const detail = when ? new Intl.DateTimeFormat(instance.locales.default, { dateStyle: "medium", timeStyle: "short", timeZone: instance.timezone }).format(new Date(when)) : undefined;
        return <Row key={thread.id} brand={brand} title={thread.subject ?? thread.threadKey ?? t("app.message.untitled")} detail={detail} onPress={() => router.push({ pathname: "/message/[id]", params: { id: thread.id } })} />;
      })}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
