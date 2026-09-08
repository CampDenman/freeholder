// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the business sells (C10.23). Contract: SCREENS.catalog.
//
// Public, because a customer who has just installed the app should see what is
// on offer before being asked who they are (§35.1).
import { FlatList } from "react-native";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { Empty, Loading, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

interface Products {
  products?: { id: string; name: string; slug?: string; summary?: string }[];
}

export default function Catalog() {
  const { instance, brand, session } = useInstance();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;

  // Services are products with a service_offerings row attached, so one
  // listing covers both — there is no separate "list services" call, and
  // inventing one in the app would be the second implementation §35.1 bans.
  const data = useScreenData<Products>({
    screen: "catalog",
    service: "catalog.listProducts",
    caller,
    cache: memoryCache,
    params: { limit: 50 },
  });

  if (!brand) return null;

  return (
    <Screen brand={brand}>
      <Title brand={brand}>Shop</Title>
      <StalenessNotice brand={brand} label={data.staleness} />

      {data.loading ? (
        <Loading brand={brand} />
      ) : data.error ? (
        <Problem brand={brand} message={data.error} onRetry={data.reload} />
      ) : (
        <FlatList
          data={data.value?.products ?? []}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Empty brand={brand} message={SCREENS.catalog.emptyKey} />}
          renderItem={({ item }) => (
            <Row brand={brand} title={item.name} detail={item.summary} />
          )}
        />
      )}
    </Screen>
  );
}
