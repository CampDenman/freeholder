// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's home (C10.23). Contract: SCREENS.home.
import { View } from "react-native";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { Body, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

interface Records {
  records?: { id: string; title: string; detail?: string }[];
}

export default function Home() {
  const { instance, brand, session } = useInstance();
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

  return (
    <Screen brand={brand}>
      <Title brand={brand}>{brand.name}</Title>
      {brand.tagline ? <Muted brand={brand}>{brand.tagline}</Muted> : null}

      <View style={{ height: 16 }} />
      <StalenessNotice brand={brand} label={data.staleness} />

      {!session ? (
        // Browsing is public; anything about *this* customer is not. Saying so
        // beats an empty list that looks broken.
        <Body brand={brand}>Sign in to see your bookings, invoices and galleries.</Body>
      ) : data.loading ? (
        <Loading brand={brand} />
      ) : data.error ? (
        <Problem brand={brand} message={data.error} onRetry={data.reload} />
      ) : (data.value?.records ?? []).length === 0 ? (
        <Empty brand={brand} message={SCREENS.home.emptyKey} />
      ) : (
        (data.value?.records ?? []).map((record) => (
          <Body brand={brand} key={record.id}>
            {record.title}
          </Body>
        ))
      )}
    </Screen>
  );
}
