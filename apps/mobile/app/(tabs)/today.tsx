// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion: today's briefing and bookings (C10.17).
import { useCallback } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { StaffScreen } from "@/lib/staff";
import { Body, Button, Empty, Loading, Muted, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Briefing = { id: string; onDate: string; status: string; sections: { key: string; title: string; body: string | null; items: { label: string; detail?: string }[] }[] };
type Appointment = { id: string; calendarName: string; startsAt: string; contactName: string | null; status: string };

function dayWindow(timezone: string): { from: string; to: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const noon = new Date(`${date}T12:00:00.000Z`);
  const shown = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(noon);
  const offset = shown.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offset.match(/GMT([+-]?)(\d{1,2})(?::?(\d{2}))?/);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  const start = new Date(Date.parse(`${date}T00:00:00.000Z`) - minutes * 60_000);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() };
}

export default function Today() {
  const { instance, brand, session, audience } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const network = useNetworkState();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const window = instance ? dayWindow(instance.timezone) : { from: "", to: "" };
  const staff = audience === "staff";
  const briefing = useScreenData<Briefing | null>({ screen: "today", service: "briefing.today", caller, cache: memoryCache, enabled: Boolean(session && staff) });
  const bookings = useScreenData<Appointment[]>({ screen: "today", service: "bookings.list", caller, cache: memoryCache, params: { ...window, limit: 50 }, enabled: Boolean(session && staff && window.from) });
  const markRead = useScreenWrite<{ id: string }>({ screen: "today", service: "briefing.markRead", caller, online });
  const reloadBriefing = briefing.reload;
  const reloadBookings = bookings.reload;
  useFocusEffect(useCallback(() => { reloadBriefing(); reloadBookings(); }, [reloadBriefing, reloadBookings]));
  if (!instance || !brand) return null;
  const sections = briefing.value?.sections ?? [];
  const appointments = bookings.value ?? [];
  const reload = () => { briefing.reload(); bookings.reload(); };
  return <StaffScreen><Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.today.titleKey)}</Title>
    {briefing.loading || bookings.loading ? <Loading brand={brand} /> : briefing.error || bookings.error ? <Problem brand={brand} message={briefing.error ?? bookings.error!} onRetry={reload} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <StalenessNotice brand={brand} label={briefing.staleness ?? bookings.staleness} />
      {sections.length === 0 && appointments.length === 0 ? <Empty brand={brand} message={t(SCREENS.today.emptyKey)} /> : null}
      {sections.map((section) => <Row key={section.key} brand={brand} title={section.title} detail={section.body ?? (section.items.map((item) => item.label).join(" · ") || undefined)} />)}
      {appointments.length ? <Body brand={brand}>{t("app.today.bookings")}</Body> : null}
      {appointments.map((booking) => <Row key={booking.id} brand={brand} title={booking.contactName ?? booking.calendarName} detail={`${new Intl.DateTimeFormat(instance.locales.default, { timeStyle: "short", timeZone: instance.timezone }).format(new Date(booking.startsAt))} · ${booking.status}`} />)}
      <Row brand={brand} title={t("app.today.capture")} onPress={() => router.push("/capture")} />
      <Row brand={brand} title={t("app.today.approvals")} onPress={() => router.push("/approvals")} />
      <Row brand={brand} title={t("app.today.agents")} onPress={() => router.push("/agents")} />
      {briefing.value && online ? <Button brand={brand} label={t("app.today.read")} onPress={() => void markRead.execute({ id: briefing.value!.id }).catch(() => {})} variant="quiet" /> : !online ? <Muted brand={brand}>{t("app.today.offline")}</Muted> : null}
      {markRead.error ? <Problem brand={brand} message={markRead.error} /> : null}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen></StaffScreen>;
}
