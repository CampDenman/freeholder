// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public newsletters and the signed-in marketing preference (C10.28).
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Newsletter = { id: string; name: string; description: string | null };
type Issue = { id: string; title: string; publishedAt: string | null };
type Profile = { name: string; email: string | null };

export default function Newsletters() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const profile = useScreenData<Profile>({ screen: "newsletters", service: "portal.myProfile", caller, cache: memoryCache, enabled: Boolean(session) });
  const lists = useScreenData<Newsletter[]>({ screen: "newsletters", service: "newsletters.listPublic", caller, cache: memoryCache, enabled: Boolean(session) });
  const issues = useScreenData<Issue[]>({ screen: "newsletters", service: "newsletters.listPublicIssues", caller, cache: memoryCache, enabled: Boolean(session) });
  const subscribe = useScreenWrite<{ status: string }>({ screen: "newsletters", service: "newsletters.subscribe", caller, online });
  const preference = useScreenWrite({ screen: "newsletters", service: "privacy.setMyMarketingPreference", caller, online });
  const reloadProfile = profile.reload;
  const reloadLists = lists.reload;
  const reloadIssues = issues.reload;
  useFocusEffect(useCallback(() => { reloadProfile(); reloadLists(); reloadIssues(); }, [reloadProfile, reloadLists, reloadIssues]));
  if (!instance || !brand) return null;
  const pending = subscribe.pending || preference.pending;
  const join = async (newsletterId: string) => {
    if (pending || !profile.value?.email) return;
    setProblem(null);
    try {
      await subscribe.execute({ newsletterId, email: profile.value.email, name: profile.value.name });
      setNotice(t("app.newsletters.subscribed"));
    } catch (error) { setProblem(error instanceof Error ? error.message : t("app.unavailable")); }
  };
  const setMarketing = async (state: "granted" | "withdrawn") => {
    if (pending) return;
    setProblem(null);
    try {
      await preference.execute({ channel: "email", state, termsVersion: "portal-privacy-v1" });
      setNotice(t("app.newsletters.preferenceSaved"));
    } catch (error) { setProblem(error instanceof Error ? error.message : t("app.unavailable")); }
  };
  const loading = profile.loading || lists.loading || issues.loading;
  const error = profile.error ?? lists.error ?? issues.error;
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.newsletters.titleKey)}</Title>
    {!session ? <SignIn /> : loading ? <Loading brand={brand} /> : error ? <Problem brand={brand} message={error} onRetry={() => { profile.reload(); lists.reload(); issues.reload(); }} /> : !lists.value?.length && !issues.value?.length ? <Empty brand={brand} message={t(SCREENS.newsletters.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={lists.staleness} />
      {notice ? <Body brand={brand}>{notice}</Body> : null}
      {problem ? <Problem brand={brand} message={problem} /> : null}
      {!online ? <Muted brand={brand}>{t("app.newsletters.offline")}</Muted> : null}
      {lists.value?.map((newsletter) => (
        <Row key={newsletter.id} brand={brand} title={newsletter.name} detail={newsletter.description ? `${newsletter.description} · ${t("app.newsletters.subscribe")}` : t("app.newsletters.subscribe")} onPress={profile.value?.email && online ? () => void join(newsletter.id) : undefined} />
      ))}
      <Button brand={brand} label={t("app.newsletters.marketingOn")} onPress={() => void setMarketing("granted")} />
      <Button brand={brand} label={t("app.newsletters.marketingOff")} onPress={() => void setMarketing("withdrawn")} variant="quiet" />
      {issues.value?.length ? issues.value.map((issue) => <Muted key={issue.id} brand={brand}>{issue.title}</Muted>) : null}
      {pending ? <Loading brand={brand} /> : null}
      <Button brand={brand} label={t("app.retry")} onPress={() => { profile.reload(); lists.reload(); issues.reload(); }} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
