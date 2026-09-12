// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.25: a real session entry for the customer screens. C10.28 completes
// the native TOTP/recovery challenge instead of sending enrolled accounts
// to the website.
import { useRef, useState } from "react";
import { ScrollView, TextInput } from "react-native";
import type { TwoFactorMethods } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { Body, Button, Loading, Problem, Title } from "@/lib/ui";

export function SignIn() {
  const { brand, signIn } = useInstance();
  const t = useAppText();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [link, setLink] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ token: string; methods: TwoFactorMethods } | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!brand) return null;
  const submit = async (kind: "password" | "request" | "link" | "code") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true); setProblem(null); setNotice(null);
    try {
      const result = await signIn({
        email: email.trim(),
        ...(kind === "password" ? { password } : {}),
        ...(kind === "link" ? { link } : {}),
        ...(kind === "code" && challenge ? { challengeToken: challenge.token, code } : {}),
      });
      if (!result.ok) {
        if (result.reason === "magic-link-sent") setNotice(t("app.auth.sent"));
        else if (result.reason === "two-factor") {
          const canCode = Boolean(result.challengeToken && (result.methods?.totp || result.methods?.recovery));
          if (canCode && result.challengeToken) {
            setChallenge({ token: result.challengeToken, methods: result.methods ?? { totp: true, recovery: true, webauthn: false } });
            setProblem(null);
          } else {
            setChallenge(null);
            setProblem(t("app.auth.two-factor.web"));
          }
        }
        else setProblem(t(`app.auth.${result.reason}`));
      }
    } catch { setProblem(t("app.auth.unreachable")); }
    finally { setPassword(""); setLink(""); setCode(""); setPending(false); inFlight.current = false; }
  };
  const style = { borderWidth: 1, borderRadius: 8, padding: 12, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface };
  return <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
    <Title brand={brand}>{t("app.auth.title")}</Title>
    <Body brand={brand}>{t("app.auth.hint")}</Body>
    {pending ? <Loading brand={brand} /> : challenge ? <>
      <Body brand={brand}>{t("app.auth.two-factor")}</Body>
      <TextInput accessibilityLabel={t("app.auth.code")} placeholder={t("app.auth.code")} placeholderTextColor={brand.colors.inkMuted} value={code} onChangeText={setCode} autoComplete="one-time-code" keyboardType="number-pad" style={style} />
      <Button brand={brand} label={t("app.auth.verify")} onPress={() => { if (code.trim()) void submit("code"); else setProblem(t("app.auth.invalid")); }} />
      <Button brand={brand} label={t("app.auth.startAgain")} onPress={() => { setChallenge(null); setProblem(null); }} variant="quiet" />
    </> : <>
      <TextInput accessibilityLabel={t("app.auth.email")} placeholder={t("app.auth.email")} placeholderTextColor={brand.colors.inkMuted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={style} />
      <Button brand={brand} label={t("app.auth.request")} onPress={() => void submit("request")} />
      <Body brand={brand}>{t("app.auth.pasteHint")}</Body>
      <TextInput accessibilityLabel={t("app.auth.link")} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} secureTextEntry style={style} />
      <Button brand={brand} label={t("app.auth.useLink")} onPress={() => { if (link.trim()) void submit("link"); else setProblem(t("app.auth.invalid")); }} />
      <TextInput accessibilityLabel={t("app.auth.password")} placeholder={t("app.auth.password")} placeholderTextColor={brand.colors.inkMuted} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" style={style} />
      <Button brand={brand} label={t("app.auth.passwordSignIn")} onPress={() => { if (password) void submit("password"); else setProblem(t("app.auth.invalid")); }} variant="quiet" />
    </>}
    {notice ? <Body brand={brand}>{notice}</Body> : null}
    {problem ? <Problem brand={brand} message={problem} /> : null}
  </ScrollView>;
}
