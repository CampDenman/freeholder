// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's home (C10.23). Contract: SCREENS.home.
import { View } from "react-native";
import { useState } from "react";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { SignIn } from "@/screens/sign-in";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

type Records = { records: { id: string; title: string; detail?: string }[] }[];

export default function Home() {
  const { instance, brand, session, signOut } = useInstance();
  const [signOutError, setSignOutError] = useState(false);
  const t = useAppText();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;

  // `portal.myRecords` is on the home contract. Asking for anything else here
  // throws before a request is made — that is what makes C10.13 load-bearing.
  const data = useScreenData<Records>({
    screen: "home",
    service: "portal.myRecords",
    caller,
    cache: memoryCache,
    params: { limit: 5 },
    enabled: Boolean(session),
  });

  if (!brand || !instance) return null;
  const records = data.value?.flatMap((room) => room.records) ?? [];

  return (
    <Screen brand={brand}>
      <Title brand={brand}>{brand.name}</Title>
      {brand.tagline ? <Muted brand={brand}>{brand.tagline}</Muted> : null}
      {session ? <Button brand={brand} label={t("app.auth.localSignOut")} variant="quiet" onPress={() => { setSignOutError(false); void signOut().catch(() => setSignOutError(true)); }} /> : null}
      {signOutError ? <Problem brand={brand} message={t("app.auth.signOutFailed")} /> : null}

      <View style={{ height: 16 }} />
      <StalenessNotice brand={brand} label={data.staleness} />

      {!session ? (
        // Browsing is public; anything about *this* customer is not. Saying so
        // beats an empty list that looks broken.
        <SignIn />
      ) : data.loading ? (
        <Loading brand={brand} />
      ) : data.error ? (
        <Problem brand={brand} message={data.error} onRetry={data.reload} />
      ) : records.length === 0 ? (
        <Empty brand={brand} message={t(SCREENS.home.emptyKey)} />
      ) : (
        records.map((record) => (
          <Body brand={brand} key={record.id}>
            {record.title}
          </Body>
        ))
      )}
    </Screen>
  );
}
