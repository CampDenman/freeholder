// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The root of the customer app (C10.23).
//
// One decision lives here: an app with no instance shows the connect screen
// and nothing else. §35.1 makes instance discovery "the first screen", because
// a white-label app that guessed which business it belonged to would be a
// white-label app that shows the wrong business.
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InstanceProvider, useInstance } from "@/lib/instance";
import { Connect } from "@/screens/connect";
import { Loading, Screen } from "@/lib/ui";
import { brandFrom } from "@freeholder/mobile-app";

function Gate() {
  const { status, brand } = useInstance();
  if (status === "loading") {
    // The neutral palette, because no instance means no brand yet — and
    // guessing one would flash somebody else's colours.
    return (
      <Screen brand={NEUTRAL}>
        <Loading brand={NEUTRAL} />
      </Screen>
    );
  }
  if (status === "needs-instance" || !brand) return <Connect />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

const NEUTRAL = brandFrom({
  url: "",
  contractVersion: 1,
  platformVersion: "",
  name: "",
  tagline: null,
  locales: { default: "en", enabled: ["en"] },
  currency: "USD",
  timezone: "UTC",
  country: "US",
  branding: { logoUrl: null, colors: {}, fontSans: null },
  api: { base: "", openapi: "", mcp: "" },
  storeUrls: { ios: null, android: null },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <InstanceProvider>
        <StatusBar style="auto" />
        <Gate />
      </InstanceProvider>
    </SafeAreaProvider>
  );
}
