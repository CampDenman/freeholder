// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One customer thread, with a customer reply (C10.28).
import { useCallback, useState } from "react";
import { ScrollView, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

type Message = { id: string; direction: "inbound" | "outbound"; channel: string; body: string; occurredAt: string };
type Thread = { id: string; subject: string | null; status: string; messages: Message[] };

export default function MessageThread() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const profile = useScreenData<{ contactId: string }>({ screen: "message", service: "portal.myProfile", caller, cache: memoryCache, enabled: Boolean(session) });
  const contactId = profile.value?.contactId;
  const data = useScreenData<Thread>({ screen: "message", service: "conversations.get", caller, cache: memoryCache, params: { id, contactId, limit: 200 }, enabled: Boolean(session && contactId && id) });
  const reply = useScreenWrite<{ id: string }>({ screen: "message", service: "conversations.replyAsContact", caller, online });
  const reloadProfile = profile.reload;
  const reloadThread = data.reload;
  useFocusEffect(useCallback(() => { reloadProfile(); reloadThread(); }, [reloadProfile, reloadThread]));
  if (!instance || !brand) return null;
  const thread = data.value;
  const send = async () => {
    if (!thread || reply.pending || !body.trim()) return;
    setProblem(null);
    try {
      await reply.execute({ id: thread.id, body: body.trim() });
      setBody("");
      setNotice(t("app.messages.sent"));
      data.reload();
    } catch (error) { setProblem(error instanceof Error ? error.message : t("app.unavailable")); }
  };
  const fieldStyle = { borderWidth: 1, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface, padding: 12, borderRadius: 8 };
  return <Screen brand={brand}>
    <Title brand={brand}>{thread?.subject ?? t(SCREENS.message.titleKey)}</Title>
    {!session ? <SignIn /> : profile.loading || data.loading ? <Loading brand={brand} /> : profile.error || data.error ? <Problem brand={brand} message={profile.error ?? data.error!} onRetry={() => { profile.reload(); data.reload(); }} /> : !thread ? <Empty brand={brand} message={t(SCREENS.message.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      {!thread.messages.length ? <Empty brand={brand} message={t(SCREENS.message.emptyKey)} /> : thread.messages.map((message) => (
        <Body brand={brand} key={message.id}>
          {message.direction === "inbound" ? t("app.messages.you") : t("app.messages.business")}
          {": "}
          {message.body}
        </Body>
      ))}
      {notice ? <Body brand={brand}>{notice}</Body> : null}
      {problem ? <Problem brand={brand} message={problem} /> : null}
      {!online ? <Muted brand={brand}>{t("app.messages.offline")}</Muted> : null}
      {reply.pending ? <Loading brand={brand} /> : <>
        <TextInput accessibilityLabel={t("app.messages.reply")} placeholder={t("app.messages.reply")} placeholderTextColor={brand.colors.inkMuted} value={body} onChangeText={setBody} multiline maxLength={50000} style={fieldStyle} />
        <Button brand={brand} label={t("app.messages.send")} onPress={() => void send()} />
      </>}
      <Button brand={brand} label={t("app.retry")} onPress={data.reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
