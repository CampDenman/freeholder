// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: agent status (C10.17).
import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Agent = { id: string; name: string; role: string; status: string; autonomy: string };
type Board = { column: string; tasks: { id: string; title: string; status: string }[] }[];

export default function Agents() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const agents = useScreenData<Agent[]>({ screen: "agents", service: "agents.list", caller, cache: memoryCache, enabled: Boolean(session) });
  const board = useScreenData<Board>({ screen: "agents", service: "agents.board", caller, cache: memoryCache, enabled: Boolean(session) });
  const reloadAgents = agents.reload;
  const reloadBoard = board.reload;
  useFocusEffect(useCallback(() => { reloadAgents(); reloadBoard(); }, [reloadAgents, reloadBoard]));
  if (!instance || !brand) return null;
  const reload = () => { agents.reload(); board.reload(); };
  const rows = agents.value ?? [];
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.agents.titleKey)}</Title>
    {!session ? <SignIn /> : agents.loading || board.loading ? <Loading brand={brand} /> : agents.error || board.error ? <Problem brand={brand} message={agents.error ?? board.error!} onRetry={reload} /> : !rows.length ? <Empty brand={brand} message={t(SCREENS.agents.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={agents.staleness ?? board.staleness} />
      {rows.map((agent) => <Row key={agent.id} brand={brand} title={agent.name} detail={`${agent.role} · ${agent.status} · ${agent.autonomy}`} />)}
      {(board.value ?? []).map((column) => column.tasks.length ? <View key={column.column} style={{ gap: 4 }}>
        <Body brand={brand}>{column.column}</Body>
        {column.tasks.map((task) => <Muted key={task.id} brand={brand}>{task.title}</Muted>)}
      </View> : null)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
