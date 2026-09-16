// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customer changes use the same policy-enforcing token services as the web (C10.25).
import { useEffect, useState } from "react";
import { AppState, Linking, Platform, ScrollView, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNetworkState } from "expo-network";
import { SCREENS } from "@freeholder/mobile-app";
import { useInstance } from "@/lib/instance";
import { useAppText } from "@/lib/strings";
import { SignIn } from "@/screens/sign-in";
import { memoryCache } from "@/lib/cache";
import { useScreenData, useScreenWrite } from "@/lib/screen-data";
import { Body, Button, Empty, Loading, Muted, Problem, Screen, Title } from "@/lib/ui";

type Appointment = { id: string; startsAt: string; endsAt: string; timezoneAtBooking: string; calendarName: string; status: string; locationDetail: string | null; mayReschedule: boolean; mayCancel: boolean; refusal: string | null; policyName: string | null; intakeFormId: string | null; waiverToken: string | null };
type Outcome = { feeMinor: number; refundDueMinor: number; outstandingMinor: number };

export default function Booking() {
  const params = useLocalSearchParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const { instance, brand, session } = useInstance();
  const router = useRouter();
  const t = useAppText();
  const [when, setWhen] = useState<Date | null>(null);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const network = useNetworkState();
  const [reason, setReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const caller = instance ? { instanceUrl: instance.url, token: session?.token ?? null } : null;
  const data = useScreenData<Appointment>({ screen: "booking", service: "bookings.byToken", caller, cache: memoryCache, params: { token }, enabled: Boolean(session && token) });
  const online = network.isConnected === true && network.isInternetReachable !== false;
  const move = useScreenWrite<Appointment>({ screen: "booking", service: "bookings.rescheduleByToken", caller, online });
  const cancel = useScreenWrite<{ outcome: Outcome | null }>({ screen: "booking", service: "bookings.cancelByToken", caller, online });
  const [moved, setMoved] = useState(false);
  const reload = data.reload;
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") reload(); });
    return () => listener.remove();
  }, [reload]);
  if (!instance || !brand) return null;
  const booking = data.value;
  const pending = move.pending || cancel.pending;
  const open = async (path: string) => {
    try { await Linking.openURL(`${instance.url}${path}`); }
    catch { setProblem(t("app.booking.openFailed")); }
  };
  const change = async (kind: "move" | "cancel") => {
    if (!booking || pending) return;
    setProblem(null);
    try {
      if (kind === "move") {
        if (!when) throw new Error(t("app.booking.invalidTime"));
        const startsAt = when.toISOString();
        const duration = Date.parse(booking.endsAt) - Date.parse(booking.startsAt);
        await move.execute({ token, startsAt, endsAt: new Date(Date.parse(startsAt) + duration).toISOString() });
        setMoved(true);
        setMessage(t("app.booking.moved"));
      } else {
        const result = await cancel.execute({ token, ...(reason.trim() ? { reason: reason.trim() } : {}) });
        setOutcome(result.outcome);
        setConfirmCancel(false);
        setMessage(t("app.booking.cancelled"));
        data.reload();
      }
    } catch (error) { setProblem(error instanceof Error ? error.message : t("app.unavailable")); }
  };
  const display = (value: string, zone: string) => `${new Intl.DateTimeFormat(instance.locales.default, { dateStyle: "full", timeStyle: "short", timeZone: zone }).format(new Date(value))} (${zone})`;
  const money = (minor: number) => {
    const formatter = new Intl.NumberFormat(instance.locales.default, { style: "currency", currency: instance.currency });
    const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    const digits = String(minor).padStart(exponent + 1, "0");
    const decimal = exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits;
    return formatter.format(decimal as Intl.StringNumericLiteral);
  };
  const fieldStyle = { borderWidth: 1, borderColor: brand.colors.rule, color: brand.colors.ink, backgroundColor: brand.colors.surface, padding: 12, borderRadius: 8 };
  return <Screen brand={brand}>
    <Title brand={brand}>{t(SCREENS.booking.titleKey)}</Title>
    {!session ? <SignIn /> : data.loading ? <Loading brand={brand} /> : data.error ? <Problem brand={brand} message={data.error} onRetry={data.reload} /> : !booking ? <Empty brand={brand} message={t(SCREENS.booking.emptyKey)} /> : <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <Body brand={brand}>{booking.calendarName}</Body>
      <Body brand={brand}>{display(booking.startsAt, booking.timezoneAtBooking)}</Body>
      {instance.timezone !== booking.timezoneAtBooking ? <Muted brand={brand}>{display(booking.startsAt, instance.timezone)}</Muted> : null}
      <Body brand={brand}>{t(`app.booking.status.${booking.status}`)}</Body>
      {booking.locationDetail ? <Body brand={brand}>{booking.locationDetail}</Body> : null}
      {booking.policyName ? <Muted brand={brand}>{booking.policyName}</Muted> : null}
      {message ? <Body brand={brand}>{message}</Body> : null}
      {problem ? <Problem brand={brand} message={problem} /> : null}
      {!online ? <Muted brand={brand}>{t("app.booking.offline")}</Muted> : null}
      {outcome ? <Body brand={brand}>{t("app.booking.fee")}: {money(outcome.feeMinor)} · {t("app.booking.refund")}: {money(outcome.refundDueMinor)} · {t("app.booking.outstanding")}: {money(outcome.outstandingMinor)}</Body> : null}
      {pending ? <Loading brand={brand} /> : moved ? <Button brand={brand} label={t("app.bookings.title")} onPress={() => router.replace("/(tabs)/bookings")} /> : <>
        {booking.intakeFormId ? <Button brand={brand} label={t("app.booking.intake")} onPress={() => void open(`/portal/appointments/${encodeURIComponent(token)}/intake`)} /> : null}
        {booking.waiverToken ? <Button brand={brand} label={t("app.booking.waiver")} onPress={() => void open(`/portal/agreements/${encodeURIComponent(booking.waiverToken!)}`)} /> : null}
        {booking.refusal ? <Muted brand={brand}>{booking.refusal}</Muted> : null}
        {booking.mayReschedule ? <>
          <Body brand={brand}>{t("app.booking.when")}</Body>
          <Button brand={brand} label={t("app.booking.date")} onPress={() => setPicker("date")} variant="quiet" />
          <Button brand={brand} label={t("app.booking.time")} onPress={() => setPicker("time")} variant="quiet" />
          {picker ? <><DateTimePicker accessibilityLabel={t("app.booking.when")} value={when ?? new Date(booking.startsAt)} mode={picker} timeZoneName={booking.timezoneAtBooking} onValueChange={(_event, value) => { setWhen(value); if (Platform.OS === "android") setPicker(null); }} onDismiss={() => setPicker(null)} /><Button brand={brand} label={t("app.booking.done")} onPress={() => setPicker(null)} variant="quiet" /></> : null}
          {when ? <Muted brand={brand}>{display(when.toISOString(), booking.timezoneAtBooking)} · {display(when.toISOString(), instance.timezone)}</Muted> : null}
          <Button brand={brand} label={t("app.booking.move")} onPress={() => void change("move")} />
        </> : null}
        {booking.mayCancel ? <>
          <TextInput accessibilityLabel={t("app.booking.reason")} placeholder={t("app.booking.reason")} placeholderTextColor={brand.colors.inkMuted} value={reason} onChangeText={setReason} maxLength={500} style={fieldStyle} />
          {confirmCancel ? <><Body brand={brand}>{t("app.booking.confirmCancel")}</Body><Button brand={brand} label={t("app.booking.cancel")} onPress={() => void change("cancel")} /><Button brand={brand} label={t("app.booking.keep")} onPress={() => setConfirmCancel(false)} variant="quiet" /></> : <Button brand={brand} label={t("app.booking.cancel")} onPress={() => setConfirmCancel(true)} variant="quiet" />}
        </> : null}
        <Button brand={brand} label={t("app.retry")} onPress={data.reload} variant="quiet" />
      </>}
    </ScrollView>}
  </Screen>;
}
