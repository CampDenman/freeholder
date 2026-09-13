// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: camera / roll / screen / share ingest, including offline
// batches that flush through the core media contract (C10.17, C10.18).
import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useNetworkState } from "expo-network";
import {
  captureBatchOwner,
  captureBatchProgress,
  SCREENS,
  type CaptureBatch,
  type CaptureDestinationKind,
  type CaptureSource,
} from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { captureTransport, enqueuePickedCapture, pickCapture } from "@/lib/capture";
import { bindCaptureBatches, captureBatches } from "@/lib/capture-store";
import { StaffScreen } from "@/lib/staff";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, Title } from "@/lib/ui";

type Session = { id: string; source: string; status: string; assetId: string | null };
type Product = { id: string; name: string };
type Page = { id: string; title: string; workingTitle: string | null };

function statusKey(status: CaptureBatch["status"]): string {
  if (status === "queued") return "app.capture.queued";
  if (status === "uploading") return "app.capture.uploading";
  if (status === "paused") return "app.capture.paused";
  if (status === "failed") return "app.capture.failed";
  if (status === "cancelled") return "app.capture.cancelled";
  return "app.capture.confirmed";
}

export default function Capture() {
  const { instance, brand, session, audience } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [destination, setDestination] = useState<CaptureDestinationKind>("library");
  const [targetId, setTargetId] = useState<string | undefined>();
  const [targetLabel, setTargetLabel] = useState<string | undefined>();
  const [batches, setBatches] = useState<CaptureBatch[]>([]);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const staff = Boolean(session && audience === "staff");
  const data = useScreenData<Session[]>({ screen: "capture", service: "media.listCaptureSessions", caller, cache: memoryCache, enabled: staff });
  const products = useScreenData<Product[]>({ screen: "capture", service: "catalog.listProducts", caller, cache: memoryCache, params: { limit: 50 }, enabled: staff });
  const pages = useScreenData<Page[]>({ screen: "capture", service: "cms.listPages", caller, cache: memoryCache, enabled: staff });
  const discard = useScreenWrite<Session>({ screen: "capture", service: "media.discardCapture", caller, online });
  const confirm = useScreenWrite<Session>({ screen: "capture", service: "media.confirmCapture", caller, online });
  const reload = data.reload;
  const refreshBatches = useCallback(() => {
    void captureBatches.list().then(setBatches);
  }, []);
  const flushQueued = useCallback(async () => {
    if (!caller?.token || !online) return;
    await captureBatches.flush({
      online,
      transport: captureTransport(caller),
      owner: captureBatchOwner({ instanceUrl: caller.instanceUrl, token: caller.token }),
    });
    refreshBatches();
    reload();
  }, [caller, online, refreshBatches, reload]);
  useEffect(() => captureBatches.subscribe(refreshBatches), [refreshBatches]);
  useEffect(() => {
    if (!instance || !session?.token) return;
    void bindCaptureBatches({ instanceUrl: instance.url, token: session.token }).then(refreshBatches);
  }, [instance, session, refreshBatches]);
  useFocusEffect(useCallback(() => { reload(); refreshBatches(); if (online) void flushQueued(); }, [reload, refreshBatches, online, flushQueued]));
  useEffect(() => {
    if (online) void flushQueued();
  }, [online, flushQueued]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && online) void flushQueued();
    });
    return () => sub.remove();
  }, [online, flushQueued]);
  if (!instance || !brand) return null;
  const consent = consentAt ? { grantedAt: consentAt, notice: t("app.capture.permission") } : null;
  const ingest = async (source: CaptureSource) => {
    if (!caller || pending) return;
    setProblem(null); setNotice(null);
    if (!consent) { setProblem(t("app.capture.consentNeeded")); return; }
    if (destination !== "library" && !targetId) { setProblem(t("app.capture.chooseDestination")); return; }
    setPending(true);
    try {
      const files = await pickCapture(source);
      if (!files.length) { setProblem(t("app.capture.pickFailed")); return; }
      const queued = await enqueuePickedCapture({
        caller,
        source,
        files,
        destination: { kind: destination, targetId, label: targetLabel },
        consent,
      });
      refreshBatches();
      if (online) {
        await flushQueued();
        const latest = await captureBatches.get(queued.id);
        if (latest.status === "confirmed") setNotice(t("app.capture.done"));
        else if (latest.status === "failed") setProblem(latest.error ?? t("app.capture.failed"));
        else setNotice(t("app.capture.waiting"));
      } else {
        setNotice(t("app.capture.waiting"));
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("app.unavailable"));
    } finally { setPending(false); }
  };
  const act = async (id: string, op: "pause" | "resume" | "cancel" | "retry") => {
    await captureBatches[op](id);
    refreshBatches();
    if (op === "resume" || op === "retry") await flushQueued();
  };
  return <StaffScreen><Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.capture.titleKey)}</Title>
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <Muted brand={brand}>{t("app.capture.permission")}</Muted>
      {consent ? null : <Button brand={brand} label={t("app.capture.consent")} onPress={() => setConsentAt(new Date().toISOString())} />}
      <Body brand={brand}>{t("app.capture.destination")}</Body>
      <Button brand={brand} label={t("app.capture.destination.library")} onPress={() => { setDestination("library"); setTargetId(undefined); setTargetLabel(undefined); }} variant={destination === "library" ? "primary" : "quiet"} />
      <Button brand={brand} label={t("app.capture.destination.product")} onPress={() => { setDestination("product"); setTargetId(undefined); setTargetLabel(undefined); }} variant={destination === "product" ? "primary" : "quiet"} />
      <Button brand={brand} label={t("app.capture.destination.page")} onPress={() => { setDestination("page"); setTargetId(undefined); setTargetLabel(undefined); }} variant={destination === "page" ? "primary" : "quiet"} />
      {destination === "product" ? (products.value ?? []).map((product) => <Row key={product.id} brand={brand} title={product.name} detail={targetId === product.id ? t("app.capture.destination.product") : undefined} onPress={() => { setTargetId(product.id); setTargetLabel(product.name); }} />) : null}
      {destination === "page" ? (pages.value ?? []).map((page) => <Row key={page.id} brand={brand} title={page.workingTitle ?? page.title} detail={targetId === page.id ? t("app.capture.destination.page") : undefined} onPress={() => { setTargetId(page.id); setTargetLabel(page.workingTitle ?? page.title); }} />) : null}
      {!consent ? <Muted brand={brand}>{t("app.capture.consentNeeded")}</Muted> : pending ? <Loading brand={brand} /> : <>
        <Button brand={brand} label={t("app.capture.camera")} onPress={() => void ingest("camera")} />
        <Button brand={brand} label={t("app.capture.cameraRoll")} onPress={() => void ingest("camera_roll")} />
        <Button brand={brand} label={t("app.capture.screen")} onPress={() => void ingest("screen")} />
        <Button brand={brand} label={t("app.capture.share")} onPress={() => void ingest("share_sheet")} variant="quiet" />
      </>}
      {!online ? <Muted brand={brand}>{t("app.capture.waiting")}</Muted> : null}
      {notice ? <Body brand={brand}>{notice}</Body> : null}
      {problem ? <Problem brand={brand} message={problem} /> : null}
      {discard.error || confirm.error ? <Problem brand={brand} message={discard.error ?? confirm.error!} /> : null}
      {data.error ? <Problem brand={brand} message={data.error} onRetry={reload} /> : null}
      <Body brand={brand}>{t("app.capture.batches")}</Body>
      {!batches.length ? <Empty brand={brand} message={t(SCREENS.capture.emptyKey)} /> : batches.map((batch) => {
        const progress = captureBatchProgress(batch);
        return <View key={batch.id} style={{ gap: 8 }}>
          <Row brand={brand} title={batch.destination.label ?? t(`app.capture.destination.${batch.destination.kind}`)} detail={`${t(statusKey(batch.status))} · ${progress.uploaded}/${progress.total} · ${progress.percent}%`} />
          {batch.status === "uploading" ? <Button brand={brand} label={t("app.capture.pause")} onPress={() => void act(batch.id, "pause")} variant="quiet" /> : null}
          {batch.status === "paused" ? <Button brand={brand} label={t("app.capture.resume")} onPress={() => void act(batch.id, "resume")} /> : null}
          {batch.status === "failed" ? <Button brand={brand} label={t("app.capture.retry")} onPress={() => void act(batch.id, "retry")} /> : null}
          {batch.status === "queued" && online ? <Button brand={brand} label={t("app.capture.flush")} onPress={() => void flushQueued()} /> : null}
          {batch.status !== "confirmed" && batch.status !== "cancelled" ? <Button brand={brand} label={t("app.capture.cancel")} onPress={() => void act(batch.id, "cancel")} variant="quiet" /> : null}
        </View>;
      })}
      {data.loading ? <Loading brand={brand} /> : null}
      {!data.value?.length ? null : data.value.map((item) => <View key={item.id} style={{ gap: 8 }}>
        <Row brand={brand} title={item.source} detail={item.status} onPress={() => setChosen(item.id)} />
        {chosen === item.id && item.status !== "confirmed" && online ? <>
          {item.status === "preview" || item.assetId ? <Button brand={brand} label={t("app.capture.confirm")} onPress={() => void confirm.execute({ id: item.id }).then(() => { setChosen(null); data.reload(); }).catch(() => {})} /> : null}
          <Button brand={brand} label={t("app.capture.discard")} onPress={() => void discard.execute({ id: item.id }).then(() => { setChosen(null); data.reload(); }).catch(() => {})} variant="quiet" />
        </> : null}
      </View>)}
      <Button brand={brand} label={t("app.retry")} onPress={() => { reload(); refreshBatches(); }} variant="quiet" />
    </ScrollView>
  </Screen></StaffScreen>;
}
