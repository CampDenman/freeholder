// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: reply as the business (C10.17).
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

type Message = { id: string; direction: "inbound" | "outbound"; body: string; occurredAt: string };
type Thread = { id: string; subject: string | null; contactName: string | null; messages: Message[] };

export default function InboxThread() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const data = useScreenData<Thread>({ screen: "inboxThread", service: "conversations.get", caller, cache: memoryCache, params: { id, limit: 200 }, enabled: Boolean(session && id) });
  const reply = useScreenWrite<{ id: string }>({ screen: "inboxThread", service: "conversations.reply", caller, online });
  const markRead = useScreenWrite<{ id: string }>({ screen: "inboxThread", service: "conversations.markRead", caller, online });
  const reload = data.reload;
  const mark = markRead.execute;
  useFocusEffect(useCallback(() => {
    reload();
    if (id && session) void mark({ id, read: true }).catch(() => {});
  }, [reload, id, session, mark]));
  if (!instance || !brand) return null;
  const thread = data.value;
  const send = async () => {
    if (!thread || !body.trim() || reply.pending) return;
    try {
      await reply.execute({ id: thread.id, body: body.trim() });
      setBody("");
      setNotice(t("app.inbox.sent"));
      data.reload();
    } catch { /* recorded */ }
  };
  const field = { borderWidth: 1, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface, padding: 12, borderRadius: 8 };
  return <Screen brand={brand}>
    <Title brand={brand}>{thread?.subject ?? thread?.contactName ?? t(SCREENS.inboxThread.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !thread ? <Empty brand={brand} message={t(SCREENS.inboxThread.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      {!thread.messages.length ? <Empty brand={brand} message={t(SCREENS.inboxThread.emptyKey)} /> : thread.messages.map((message) => <Body brand={brand} key={message.id}>{message.direction === "inbound" ? message.body : message.body}</Body>)}
      {notice ? <Body brand={brand}>{notice}</Body> : null}
      {reply.error ? <Problem brand={brand} message={reply.error} /> : null}
      {!online ? <Muted brand={brand}>{t("app.inbox.offline")}</Muted> : <>
        <TextInput accessibilityLabel={t("app.inbox.reply")} placeholder={t("app.inbox.reply")} placeholderTextColor={brand.colors.inkMuted} value={body} onChangeText={setBody} multiline maxLength={50000} style={field} />
        <Button brand={brand} label={t("app.inbox.send")} onPress={() => void send()} />
      </>}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
