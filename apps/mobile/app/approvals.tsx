// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: agent write approvals (C10.17).
import { useCallback, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { StaffScreen } from "@/lib/staff";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

type Approval = { id: string; summary: string; status: string; kind: string; serviceName: string };

export default function Approvals() {
  const { instance, brand, session, audience } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [note, setNote] = useState("");
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const data = useScreenData<Approval[]>({ screen: "approvals", service: "agents.listApprovals", caller, cache: memoryCache, params: { status: "pending", limit: 50 }, enabled: Boolean(session && audience === "staff") });
  const approve = useScreenWrite<{ approval: Approval }>({ screen: "approvals", service: "agents.approveWrite", caller, online });
  const reject = useScreenWrite<{ approval: Approval }>({ screen: "approvals", service: "agents.rejectWrite", caller, online });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const field = { borderWidth: 1, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface, padding: 12, borderRadius: 8 };
  const pending = data.value ?? [];
  return <StaffScreen><Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.approvals.titleKey)}</Title>
    {data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : !pending.length ? <Empty brand={brand} message={t(SCREENS.approvals.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={data.staleness} />
      {!online ? <Muted brand={brand}>{t("app.approvals.offline")}</Muted> : null}
      {approve.error || reject.error ? <Problem brand={brand} message={approve.error ?? reject.error!} /> : null}
      <TextInput accessibilityLabel={t("app.approvals.note")} placeholder={t("app.approvals.note")} placeholderTextColor={brand.colors.inkMuted} value={note} onChangeText={setNote} style={field} />
      {pending.map((item) => <View key={item.id} style={{ gap: 8 }}>
        <Body brand={brand}>{item.summary}</Body>
        <Muted brand={brand}>{item.serviceName}</Muted>
        {online ? <>
          <Button brand={brand} label={t("app.approvals.approve")} onPress={() => void approve.execute({ id: item.id, note: note.trim() || undefined }).then(() => data.reload()).catch(() => {})} />
          {note.trim() ? <Button brand={brand} label={t("app.approvals.reject")} onPress={() => void reject.execute({ id: item.id, note: note.trim() }).then(() => data.reload()).catch(() => {})} variant="quiet" /> : <Muted brand={brand}>{t("app.approvals.needNote")}</Muted>}
        </> : null}
      </View>)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen></StaffScreen>;
}
