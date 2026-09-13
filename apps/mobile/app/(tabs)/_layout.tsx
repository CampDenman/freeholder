// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's tabs, or the owner companion tabs (C10.17).
//
// The order is `tabOrderFor` from the screen contracts, not a list retyped
// here. Extra files in this folder stay registered so Expo Router can open
// them, but `href: null` hides them from the bar the other audience sees.
import { Tabs } from "expo-router";
import { SCREENS, TAB_ORDER, OWNER_TAB_ORDER, tabFileName, tabOrderFor } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";

const ALL_TABS = [...TAB_ORDER, ...OWNER_TAB_ORDER];

export default function TabsLayout() {
  const { brand, audience } = useInstance();
  const t = useAppText();
  const order = tabOrderFor(audience);
  const visible = new Set(order.map(tabFileName));
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: brand?.colors.accent,
        tabBarInactiveTintColor: brand?.colors.inkMuted,
      }}
    >
      {ALL_TABS.map((id) => {
        const name = tabFileName(id);
        return (
          <Tabs.Screen
            key={id}
            name={name}
            options={{
              title: t(SCREENS[id].titleKey),
              href: visible.has(name) ? undefined : null,
            }}
          />
        );
      })}
    </Tabs>
  );
}
