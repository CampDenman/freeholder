// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Companion screens are staff-only; a customer deep link must not look broken.
import { useRouter } from "expo-router";
import { useInstance } from "./instance";
import { useAppText } from "./strings";
import { SignIn } from "@/screens/sign-in";
import { Button, Empty, Screen } from "./ui";

export function StaffScreen({ children }: { children: React.ReactNode }) {
  const { brand, audience, session } = useInstance();
  const t = useAppText();
  const router = useRouter();
  if (!brand) return null;
  if (!session) {
    return (
      <Screen brand={brand}>
        <SignIn />
      </Screen>
    );
  }
  if (audience !== "staff") {
    return (
      <Screen brand={brand}>
        <Empty brand={brand} message={t("app.companion.staffOnly")} />
        <Button brand={brand} label={t("app.companion.customerHome")} onPress={() => router.replace("/")} />
      </Screen>
    );
  }
  return children;
}
