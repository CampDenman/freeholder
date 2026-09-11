// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customer appointments, using the shared self-service contracts (C10.25).
import { useCallback } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { SignIn } from "@/screens/sign-in";
import { memoryCache } from "@/lib/cache";
import { useScreenData } from "@/lib/screen-data";
import { Button, Empty, Loading, Problem, Row, Screen, StalenessNotice, Title } from "@/lib/ui";

type Appointment = { id: string; calendarName: string; startsAt: string; timezoneAtBooking: string; status: string };
const noCache = { async get() { return null; }, async set() {}, async delete() {} };

export default function Bookings() {
  const { instance, brand, session } = useInstance();
  const t = useAppText();
  const router = useRouter();
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const profile = useScreenData<{ contactId: string }>({ screen: "bookings", service: "portal.myProfile", caller, cache: memoryCache, enabled: Boolean(session) });
  const contactId = profile.value?.contactId;
  const data = useScreenData<Appointment[]>({ screen: "bookings", service: "bookings.list", caller, cache: memoryCache, params: { contactId, limit: 200 }, enabled: Boolean(session && contactId) });
  const ids = data.value?.map((booking) => booking.id) ?? [];
  // Capability links are never cached. A stale list remains readable but cannot
  // supply a credential retained after access was removed.
  const links = useScreenData<{ id: string; token: string }[]>({ screen: "bookings", service: "bookings.myLinks", caller, cache: noCache, params: { contactId, bookingIds: ids }, enabled: Boolean(session && contactId && ids.length) });
  const reloadProfile = profile.reload;
  const reloadBookings = data.reload;
  const reloadLinks = links.reload;
  useFocusEffect(useCallback(() => { reloadProfile(); reloadBookings(); reloadLinks(); }, [reloadProfile, reloadBookings, reloadLinks]));
  if (!instance || !brand) return null;
  const reload = () => { profile.reload(); data.reload(); links.reload(); };
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.bookings.titleKey)}</Title>
    {!session ? <SignIn /> : profile.loading || data.loading ? <Loading brand={brand} /> : profile.error || data.error ? <Problem brand={brand} message={profile.error ?? data.error!} onRetry={reload} /> : !data.value?.length ? <Empty brand={brand} message={t(SCREENS.bookings.emptyKey)} /> : <ScrollView>
      <StalenessNotice brand={brand} label={data.staleness} />
      {links.error ? <Problem brand={brand} message={links.error} onRetry={links.reload} /> : null}
      {data.value.map((booking) => {
        const token = links.value?.find((link) => link.id === booking.id)?.token;
        const when = new Intl.DateTimeFormat(instance.locales.default, { dateStyle: "medium", timeStyle: "short", timeZone: booking.timezoneAtBooking }).format(new Date(booking.startsAt));
        return <Row key={booking.id} brand={brand} title={booking.calendarName} detail={`${when} (${booking.timezoneAtBooking}) · ${t(`app.booking.status.${booking.status}`)}`} onPress={token ? () => router.push({ pathname: "/booking/[token]", params: { token } }) : undefined} />;
      })}
      <Button brand={brand} label={t("app.retry")} onPress={reload} variant="quiet" />
    </ScrollView>}
  </Screen>;
}
