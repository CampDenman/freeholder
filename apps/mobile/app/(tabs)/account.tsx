// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own details, records, and sign-out (C10.28).
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, Title } from "@/lib/ui";

type Profile = { contactId: string; name: string; email: string | null; phone: string | null };
type Room = { key: string; failed: boolean; count: number; records: { id: string; title: string }[] };

export default function Account() {
  const { instance, brand, session, deviceToken, signOut } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const network = useNetworkState();
  const [signOutError, setSignOutError] = useState(false);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const profile = useScreenData<Profile>({ screen: "account", service: "portal.myProfile", caller, cache: memoryCache, enabled: Boolean(session) });
  const records = useScreenData<Room[]>({ screen: "account", service: "portal.myRecords", caller, cache: memoryCache, params: { limit: 5 }, enabled: Boolean(session) });
  const revoke = useScreenWrite<{ revoked: boolean }>({ screen: "account", service: "notifications.revokeDevice", caller, online });
  const reloadProfile = profile.reload;
  const reloadRecords = records.reload;
  useFocusEffect(useCallback(() => { reloadProfile(); reloadRecords(); }, [reloadProfile, reloadRecords]));
  if (!instance || !brand) return null;
  const leave = async () => {
    setSignOutError(false);
    try {
      if (deviceToken && online) await revoke.execute({ token: deviceToken }).catch(() => {});
      await signOut();
    } catch { setSignOutError(true); }
  };
  const items = records.value?.flatMap((room) => room.records) ?? [];
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.account.titleKey)}</Title>
    {!session ? <SignIn /> : profile.loading || records.loading ? <Loading brand={brand} /> : profile.error || records.error ? <Problem brand={brand} message={profile.error ?? records.error!} onRetry={() => { profile.reload(); records.reload(); }} /> : !profile.value ? <Empty brand={brand} message={t(SCREENS.account.emptyKey)} /> : <ScrollView>
      <Body brand={brand}>{profile.value.name}</Body>
      {profile.value.email ? <Muted brand={brand}>{profile.value.email}</Muted> : null}
      {profile.value.phone ? <Muted brand={brand}>{profile.value.phone}</Muted> : null}
      {items.length ? items.map((record) => <Row key={record.id} brand={brand} title={record.title} />) : <Muted brand={brand}>{t(SCREENS.account.emptyKey)}</Muted>}
      <Row brand={brand} title={t("app.account.messages")} onPress={() => router.push("/messages")} />
      <Row brand={brand} title={t("app.account.newsletters")} onPress={() => router.push("/newsletters")} />
      <Button brand={brand} label={t("app.account.signOut")} onPress={() => void leave()} variant="quiet" />
      {signOutError ? <Problem brand={brand} message={t("app.auth.signOutFailed")} /> : null}
    </ScrollView>}
  </Screen>;
}
