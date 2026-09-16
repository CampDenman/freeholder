// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The small set of pieces every screen is built from (C10.23).
//
// Colours come from the instance's own semantic tokens via `brandFrom`
// (C10.12), never from a literal here. That is the same rule the web admin
// follows and for the same reason: a colour written into a component is a
// colour that only works on one ground and cannot be rebranded without a
// store review.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Brand } from "@freeholder/mobile-app";
import { useAppText } from "./strings";

export function Screen({
  brand,
  children,
}: {
  brand: Brand;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.screen, { backgroundColor: brand.colors.surface }]}>{children}</View>
  );
}

export function Title({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  // `accessibilityRole="header"` rather than styling alone: a screen reader
  // needs the heading to be a heading, not large text.
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: brand.colors.ink }]}>
      {children}
    </Text>
  );
}

export function Body({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <Text style={[styles.body, { color: brand.colors.ink }]}>{children}</Text>;
}

export function Muted({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <Text style={[styles.muted, { color: brand.colors.inkMuted }]}>{children}</Text>;
}

/**
 * The line a stale screen carries, and nothing when it is live.
 *
 * §35.1 requires cached content to say *when* it was fetched. Rendering this
 * above every list is how that promise is kept without each screen
 * remembering to.
 */
export function StalenessNotice({ brand, label }: { brand: Brand; label: string | null }) {
  if (!label) return null;
  return (
    <View style={[styles.notice, { borderColor: brand.colors.rule }]}>
      <Muted brand={brand}>{label}</Muted>
    </View>
  );
}

/** Loading, empty and error are states a screen has, not accidents. */
export function Loading({ brand }: { brand: Brand }) {
  const t = useAppText();
  return (
    <View style={styles.centred}>
      <ActivityIndicator accessibilityLabel={t("app.loading")} color={brand.colors.accent} />
    </View>
  );
}

export function Empty({ brand, message }: { brand: Brand; message: string }) {
  return (
    <View style={styles.centred}>
      <Muted brand={brand}>{message}</Muted>
    </View>
  );
}

export function Problem({
  brand,
  message,
  onRetry,
}: {
  brand: Brand;
  message: string;
  onRetry?: () => void;
}) {
  const t = useAppText();
  return (
    <View style={styles.centred}>
      <Text style={[styles.body, { color: brand.colors.danger }]}>{message}</Text>
      {onRetry ? (
        <Button brand={brand} label={t("app.retry")} onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function Button({
  brand,
  label,
  onPress,
  variant = "primary",
}: {
  brand: Brand;
  label: string;
  onPress: () => void;
  variant?: "primary" | "quiet";
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? brand.colors.accent : "transparent",
          borderColor: brand.colors.rule,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: primary ? brand.colors.onAccent : brand.colors.ink }}>{label}</Text>
    </Pressable>
  );
}

export function Row({
  brand,
  title,
  detail,
  onPress,
}: {
  brand: Brand;
  title: string;
  detail?: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={[styles.row, { borderColor: brand.colors.rule }]}>
      <Text style={[styles.body, { color: brand.colors.ink }]}>{title}</Text>
      {detail ? <Muted brand={brand}>{detail}</Muted> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  body: { fontSize: 16 },
  muted: { fontSize: 13 },
  notice: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  centred: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  button: { borderWidth: 1, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center" },
  row: { borderBottomWidth: 1, paddingVertical: 14, gap: 2 },
});
