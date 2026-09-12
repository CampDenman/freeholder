// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.27: proofing uses the same gallery services as app/g/[slug].
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Image, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS, type Brand } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { usePrivateImage } from "@/lib/gallery-image";
import { SignIn } from "@/screens/sign-in";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, StalenessNotice, Title } from "@/lib/ui";

const PROOF_KINDS = ["favorite", "select", "reject"] as const;
type ProofKind = (typeof PROOF_KINDS)[number];
type Opened = { ok: true; sessionToken: string } | { ok: false };
type Session = {
  ok: true;
  sessionToken: string;
  gallery: { title: string; slug: string };
  items: { id: string; assetId: string; altText?: string | null; filename?: string }[];
  selections: { assetId: string; kind: ProofKind; comment: string | null }[];
  round: { state: "open" | "submitted" | "approved" | "reopened"; note: string | null } | null;
  lastDecided: { state: "open" | "submitted" | "approved" | "reopened"; note: string | null } | null;
};

export default function Gallery() {
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const network = useNetworkState();
  const [held, setHeld] = useState<{ identity: string; token: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const identity = `${slug}|${session?.token ?? ""}`;
  const galleryToken = held?.identity === identity ? held.token : null;
  const networkReady = network.isConnected !== null && network.isConnected !== undefined;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const open = useScreenWrite<Opened>({ screen: "gallery", service: "galleries.openWithLogin", caller, online });
  const data = useScreenData<Session>({ screen: "gallery", service: "galleries.viewSession", caller, cache: memoryCache, params: { sessionToken: galleryToken }, enabled: Boolean(session && galleryToken) });
  const mark = useScreenWrite({ screen: "gallery", service: "galleries.setSelection", caller, online });
  const unmark = useScreenWrite({ screen: "gallery", service: "galleries.clearSelection", caller, online });
  const submit = useScreenWrite({ screen: "gallery", service: "galleries.submitRound", caller, online });
  const pending = open.pending || mark.pending || unmark.pending || submit.pending;
  const reload = data.reload;
  const executeOpen = open.execute;
  const opening = useRef(false);
  const generation = useRef(0);

  const unlock = useCallback(async () => {
    if (!slug || !session || opening.current || open.pending) return;
    setProblem(null);
    setDenied(false);
    if (!online) { setProblem("offline"); return; }
    const request = generation.current;
    opening.current = true;
    try {
      const result = await executeOpen({ slug });
      if (request !== generation.current) return;
      if (result.ok) setHeld({ identity: `${slug}|${session.token}`, token: result.sessionToken });
      else { setHeld(null); setDenied(true); }
    } catch (error) {
      if (request !== generation.current) return;
      // A superseded in-flight open still occupies useScreenWrite; wait for pending to clear.
      if (error instanceof Error && error.message === "A request is already in progress.") return;
      setHeld(null);
      setProblem(error instanceof Error ? error.message : "unavailable");
    } finally { if (request === generation.current) opening.current = false; }
  }, [slug, session, online, executeOpen, open.pending]);

  useEffect(() => {
    generation.current += 1;
    opening.current = false;
    setHeld(null);
    setDenied(false);
    setProblem(null);
    setMessage(null);
  }, [identity]);
  useEffect(() => {
    if (!session || !slug || galleryToken || denied || !online || open.pending) return;
    if (problem !== null && problem !== "offline") return;
    void unlock();
  }, [session, slug, galleryToken, denied, problem, online, open.pending, unlock]);
  useFocusEffect(useCallback(() => { if (galleryToken) reload(); }, [galleryToken, reload]));
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => { if (state === "active" && galleryToken) reload(); });
    return () => listener.remove();
  }, [galleryToken, reload]);

  if (!instance || !brand) return null;
  const opened = data.value?.gallery.slug === slug ? data.value : null;
  const sentBack = opened?.round?.state === "open" && opened.lastDecided?.state === "reopened" ? opened.lastDecided : null;
  const roundOpen = (opened?.round?.state ?? "open") === "open";
  const shownProblem = problem === "offline" ? t("app.gallery.offline") : problem === "unavailable" ? t("app.unavailable") : problem;
  const change = async (itemId: string, kind: ProofKind | "clear", comment?: string) => {
    if (!galleryToken || pending) return;
    setProblem(null);
    if (!online) { setProblem("offline"); return; }
    try {
      if (kind === "clear") await unmark.execute({ sessionToken: galleryToken, itemId });
      else await mark.execute({ sessionToken: galleryToken, itemId, kind, comment: comment || null });
      reload();
    } catch (error) { setProblem(error instanceof Error ? error.message : "unavailable"); }
  };
  const send = async () => {
    if (!galleryToken || pending) return;
    setProblem(null);
    if (!online) { setProblem("offline"); return; }
    try {
      await submit.execute({ sessionToken: galleryToken });
      setMessage(t("app.gallery.round.submitted"));
      reload();
    } catch (error) { setProblem(error instanceof Error ? error.message : "unavailable"); }
  };
  const retry = () => { setDenied(false); setProblem(null); setHeld(null); };

  return <Screen brand={brand}>
    <Title brand={brand}>{opened?.gallery.title ?? t(SCREENS.gallery.titleKey)}</Title>
    {!session ? <SignIn /> : open.pending && !galleryToken ? <Loading brand={brand} /> : !galleryToken && !denied && !networkReady ? <Loading brand={brand} /> : shownProblem && !opened ? <Problem brand={brand} message={shownProblem} onRetry={retry} /> : denied ? <Empty brand={brand} message={t(SCREENS.gallery.emptyKey)} /> : !galleryToken ? <Problem brand={brand} message={shownProblem ?? t("app.gallery.offline")} onRetry={retry} /> : data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={retry} /> : !opened ? <Empty brand={brand} message={t(SCREENS.gallery.emptyKey)} /> : <FlatList
      data={opened.items}
      keyExtractor={(item) => item.id}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
      ListHeaderComponent={<>
        <StalenessNotice brand={brand} label={data.staleness} />
        {message ? <Body brand={brand}>{message}</Body> : null}
        {opened.round?.state === "submitted" ? <Muted brand={brand}>{t("app.gallery.round.submitted")}</Muted> : null}
        {opened.round?.state === "approved" ? <Body brand={brand}>{t("app.gallery.round.approved")}</Body> : null}
        {sentBack ? <><Muted brand={brand}>{t("app.gallery.round.reopened")}</Muted>{sentBack.note ? <Body brand={brand}>{sentBack.note}</Body> : null}</> : null}
        {shownProblem ? <Problem brand={brand} message={shownProblem} /> : null}
        {!online ? <Muted brand={brand}>{t("app.gallery.offline")}</Muted> : null}
        {opened.items.length === 0 ? <Empty brand={brand} message={t("app.gallery.items.empty")} /> : null}
      </>}
      renderItem={({ item }) => <ProofItem brand={brand} caller={caller} slug={slug} item={item} mark={opened.selections.find((selection) => selection.assetId === item.assetId)} galleryToken={galleryToken} pending={pending} t={t} onChange={change} />}
      ListFooterComponent={<>
        {opened.items.length > 0 && roundOpen ? <Button brand={brand} label={t("app.gallery.round.submit")} onPress={() => void send()} /> : null}
        <Button brand={brand} label={t("app.retry")} onPress={retry} variant="quiet" />
      </>}
    />}
  </Screen>;
}

function ProofItem({
  brand, caller, slug, item, mark, galleryToken, pending, t, onChange,
}: {
  brand: Brand;
  caller: { instanceUrl: string; token: string | null } | null;
  slug: string;
  item: { id: string; altText?: string | null; filename?: string };
  mark: { kind: ProofKind; comment: string | null } | undefined;
  galleryToken: string;
  pending: boolean;
  t: (key: string) => string;
  onChange: (itemId: string, kind: ProofKind | "clear", comment?: string) => Promise<void>;
}) {
  const image = usePrivateImage({ caller, slug, itemId: item.id, galleryToken });
  const [comment, setComment] = useState(mark?.comment ?? "");
  useEffect(() => { setComment(mark?.comment ?? ""); }, [mark?.comment]);
  const label = item.altText || item.filename || t("app.gallery.photo.untitled");
  const fieldStyle = { borderWidth: 1, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface, padding: 12, borderRadius: 8 };
  return <View style={{ gap: 8 }}>
    {image.loading ? <Loading brand={brand} /> : image.value ? <Image accessibilityRole="image" accessibilityLabel={label} source={{ uri: image.value.uri }} style={{ width: "100%", aspectRatio: 1, borderWidth: 1, borderColor: brand.colors.rule, borderRadius: 8, backgroundColor: brand.colors.surface }} /> : image.error ? <Muted brand={brand}>{image.error}</Muted> : <Muted brand={brand}>{t("app.gallery.photo.unavailable")}</Muted>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {PROOF_KINDS.map((kind) => <Button key={kind} brand={brand} label={t(`app.gallery.proof.${kind}`)} variant={mark?.kind === kind ? "primary" : "quiet"} onPress={() => { if (!pending) void onChange(item.id, kind, comment); }} />)}
      {mark ? <Button brand={brand} label={t("app.gallery.proof.clear")} variant="quiet" onPress={() => { if (!pending) void onChange(item.id, "clear"); }} /> : null}
    </View>
    <TextInput accessibilityLabel={t("app.gallery.proof.comment")} placeholder={t("app.gallery.proof.comment")} placeholderTextColor={brand.colors.inkMuted} value={comment} onChangeText={setComment} maxLength={2000} style={fieldStyle} />
    <Button brand={brand} label={t("app.gallery.proof.saveComment")} variant="quiet" onPress={() => { if (!pending) void onChange(item.id, mark?.kind ?? "favorite", comment); }} />
  </View>;
}
