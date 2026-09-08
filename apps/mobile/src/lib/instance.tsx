// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which instance this app is talking to, and who is signed in (C10.23).
//
// All four of the hard questions were answered in `@freeholder/mobile-app`
// (C10.12) and none of them are re-answered here. This file is the React
// binding: it holds the resolved instance in context, keeps the session in the
// platform keychain through `expo-secure-store`, and hands screens a caller.
//
// §35.1: "The app is a client, never a second implementation." So there is no
// business rule below — only storage, context and fetch.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  brandFrom,
  discover,
  loadSession,
  saveSession,
  signOut as clearSession,
  type Brand,
  type Instance,
  type SecretStore,
  type Session,
} from "@freeholder/mobile-app";

/**
 * The keychain, behind the interface `@freeholder/mobile-app` asks for.
 *
 * Deliberately `expo-secure-store` rather than `AsyncStorage`: §35.1 requires
 * the token to live where only the OS keychain writes, never in
 * JavaScript-reachable storage that lands in unencrypted device backups.
 */
export const keychain: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  delete: (key) => SecureStore.deleteItemAsync(key),
};

/** The remembered address, so a returning customer does not retype it. */
const INSTANCE_KEY = "freeholder.instance";

export interface InstanceState {
  status: "loading" | "needs-instance" | "ready";
  instance: Instance | null;
  brand: Brand | null;
  session: Session | null;
  /** Non-null when the last attempt to reach an address failed. */
  problem: string | null;
  connect(address: string): Promise<void>;
  forget(): Promise<void>;
  signOut(): Promise<void>;
}

const InstanceContext = createContext<InstanceState | null>(null);

export function useInstance(): InstanceState {
  const value = useContext(InstanceContext);
  if (!value) throw new Error("useInstance must be used inside <InstanceProvider>.");
  return value;
}

export function InstanceProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<InstanceState["status"]>("loading");

  const connect = useCallback(async (address: string) => {
    const result = await discover(address, (url) => fetch(url));
    if (!result.ok) {
      // Every refusal already carries a sentence written for the customer, so
      // the app shows what the resolver said rather than inventing its own.
      setProblem(result.message);
      setStatus("needs-instance");
      return;
    }
    await SecureStore.setItemAsync(INSTANCE_KEY, result.instance.url);
    setInstance(result.instance);
    setProblem(null);
    setStatus("ready");
  }, []);

  const forget = useCallback(async () => {
    await SecureStore.deleteItemAsync(INSTANCE_KEY);
    await clearSession(keychain);
    setInstance(null);
    setSession(null);
    setStatus("needs-instance");
  }, []);

  const signOut = useCallback(async () => {
    // Token first: an app that clears its in-memory state and is then killed
    // by the OS before the keychain write lands has "signed out" into a state
    // that signs itself back in on next launch.
    await clearSession(keychain);
    setSession(null);
  }, []);

  useEffect(() => {
    void (async () => {
      const remembered = await SecureStore.getItemAsync(INSTANCE_KEY);
      if (!remembered) {
        setStatus("needs-instance");
        return;
      }
      setSession(await loadSession(keychain));
      await connect(remembered);
    })();
  }, [connect]);

  const value = useMemo<InstanceState>(
    () => ({
      status,
      instance,
      brand: instance ? brandFrom(instance) : null,
      session,
      problem,
      connect,
      forget,
      signOut,
    }),
    [status, instance, session, problem, connect, forget, signOut],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export { saveSession };
