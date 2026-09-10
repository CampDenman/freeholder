// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's tabs (C10.23).
//
// The order is `TAB_ORDER` from the screen contracts (C10.13), not a list
// retyped here — so "which tabs exist and in what order" has one answer that a
// test can check.
import { Tabs } from "expo-router";
import { TAB_ORDER, SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";

/** Only the tabs this release actually renders. C10.25–C10.28 fill the rest. */
const BUILT = new Set(["home", "catalog", "bookings"]);

export default function TabsLayout() {
  const { brand } = useInstance();
  const t = useAppText();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: brand?.colors.accent,
        tabBarInactiveTintColor: brand?.colors.inkMuted,
      }}
    >
      {TAB_ORDER.filter((id) => BUILT.has(id)).map((id) => (
        <Tabs.Screen
          key={id}
          name={id === "home" ? "index" : id}
          options={{ title: t(SCREENS[id].titleKey) }}
        />
      ))}
    </Tabs>
  );
}
