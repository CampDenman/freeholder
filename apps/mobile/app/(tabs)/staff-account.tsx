// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: staff identity and sign-out (C10.17).
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
import { Body, Button, Empty, Loading, Muted, Problem, Screen, Title } from "@/lib/ui";

type Who = { userId: string; role: string; email: string };

export default function StaffAccount() {
  const { instance, brand, session, deviceToken, signOut } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [signOutError, setSignOutError] = useState(false);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const who = useScreenData<Who>({ screen: "staffAccount", service: "auth.whoami", caller, cache: memoryCache, params: { token: session?.token }, enabled: Boolean(session) });
  const revoke = useScreenWrite<{ revoked: boolean }>({ screen: "staffAccount", service: "notifications.revokeDevice", caller, online });
  const reload = who.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const leave = async () => {
    setSignOutError(false);
    try {
      if (deviceToken && online) await revoke.execute({ token: deviceToken }).catch(() => {});
      await signOut();
    } catch { setSignOutError(true); }
  };
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.staffAccount.titleKey)}</Title>
    {!session ? <SignIn /> : who.loading ? <Loading brand={brand} /> : who.error ? <Problem brand={brand} message={who.error} onRetry={reload} /> : !who.value ? <Empty brand={brand} message={t(SCREENS.staffAccount.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <Muted brand={brand}>{t("app.companion.mode")}</Muted>
      <Body brand={brand}>{who.value.email}</Body>
      <Muted brand={brand}>{who.value.role}</Muted>
      <Button brand={brand} label={t("app.staffAccount.signOut")} onPress={() => void leave()} variant="quiet" />
      {signOutError ? <Problem brand={brand} message={t("app.auth.signOutFailed")} /> : null}
    </ScrollView>}
  </Screen>;
}
