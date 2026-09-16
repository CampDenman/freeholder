// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The first screen: which business is this? (§35.1, C10.23)
//
// §35.1: "It asks for the business's address, fetches
// `/.well-known/freeholder` for the name, branding and contract version, and
// refuses an instance whose contract is newer than the binary understands —
// with the store link to update, not a broken screen. A customer whose
// photographer moved domains types the new one; nobody reinstalls."
//
// Every refusal shown here is a sentence `discover()` already wrote, in the
// customer's terms. The screen does not decide what went wrong; it decides
// where to put it.
import { useState } from "react";
import { Linking, TextInput, View, StyleSheet } from "react-native";
import { brandFrom } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { Body, Button, Muted, Screen, Title } from "@/lib/ui";

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

export function Connect() {
  const { connect, problem } = useInstance();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    void connect(address).finally(() => setBusy(false));
  };

  return (
    <Screen brand={NEUTRAL}>
      <View style={styles.body}>
        <Title brand={NEUTRAL}>Find your business</Title>
        <Body brand={NEUTRAL}>
          Enter the web address of the business you booked with.
        </Body>

        <TextInput
          accessibilityLabel="Business web address"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          placeholder="example.com"
          placeholderTextColor={NEUTRAL.colors.inkMuted}
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={submit}
          style={[
            styles.input,
            { borderColor: NEUTRAL.colors.rule, color: NEUTRAL.colors.ink },
          ]}
        />

        {problem ? <Body brand={NEUTRAL}>{problem}</Body> : null}

        <Button
          brand={NEUTRAL}
          label={busy ? "Looking…" : "Continue"}
          onPress={submit}
        />

        <Muted brand={NEUTRAL}>
          You can change this later. Nothing is sent anywhere until you connect.
        </Muted>
      </View>
    </Screen>
  );
}

/**
 * Offered only when the refusal is "this app is too old".
 *
 * That is the one failure a customer cannot fix by retyping, so it is the one
 * that gets a button instead of advice.
 */
export function StoreLink({ url }: { url: string }) {
  return (
    <Button brand={NEUTRAL} label="Update this app" onPress={() => void Linking.openURL(url)} />
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: "center", gap: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 16 },
});
