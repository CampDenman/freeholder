// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: camera / roll / screen / share ingest (C10.17).
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS, type CaptureSource } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { pickCapture, uploadPickedCapture } from "@/lib/capture";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, Title } from "@/lib/ui";

type Session = { id: string; source: string; status: string; assetId: string | null };

export default function Capture() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const data = useScreenData<Session[]>({ screen: "capture", service: "media.listCaptureSessions", caller, cache: memoryCache, enabled: Boolean(session) });
  const discard = useScreenWrite<Session>({ screen: "capture", service: "media.discardCapture", caller, online });
  const reload = data.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!instance || !brand) return null;
  const ingest = async (source: CaptureSource) => {
    if (!caller || pending) return;
    setProblem(null); setNotice(null);
    if (!online) { setProblem(t("app.capture.offline")); return; }
    setPending(true);
    try {
      const file = await pickCapture(source);
      if (!file) { setProblem(t("app.capture.pickFailed")); return; }
      await uploadPickedCapture({ caller, source, file, online });
      setNotice(t("app.capture.done"));
      data.reload();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("app.unavailable"));
    } finally { setPending(false); }
  };
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.capture.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading || pending ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <Muted brand={brand}>{t("app.capture.permission")}</Muted>
      {!online ? <Muted brand={brand}>{t("app.capture.offline")}</Muted> : <>
        <Button brand={brand} label={t("app.capture.camera")} onPress={() => void ingest("camera")} />
        <Button brand={brand} label={t("app.capture.cameraRoll")} onPress={() => void ingest("camera_roll")} />
        <Button brand={brand} label={t("app.capture.screen")} onPress={() => void ingest("screen")} />
        <Button brand={brand} label={t("app.capture.share")} onPress={() => void ingest("share_sheet")} variant="quiet" />
      </>}
      {notice ? <Body brand={brand}>{notice}</Body> : null}
      {problem ? <Problem brand={brand} message={problem} /> : null}
      {!data.value?.length ? <Empty brand={brand} message={t(SCREENS.capture.emptyKey)} /> : data.value.map((item) => <Row key={item.id} brand={brand} title={item.source} detail={item.status} onPress={online && item.status !== "confirmed" ? () => void discard.execute({ id: item.id }).then(() => data.reload()).catch(() => {}) : undefined} />)}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
