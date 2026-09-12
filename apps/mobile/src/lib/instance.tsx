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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { privateCaches, privateCacheOwner } from "./cache";
import { fetchWithTimeout } from "./transport";
import {
  brandFrom,
  discoverWithCache,
  rememberInstance,
  normalizeAddress,
  noCache,
  loadSession,
  saveSession,
  signIn as requestSignIn,
  completeTwoFactorSignIn,
  redeemSignInLink,
  signOut as clearSession,
  loadDeviceToken,
  clearDeviceToken,
  type Brand,
  type Instance,
  type SecretStore,
  type Session,
  type SignInResult,
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
  /** Push token for this install, if one has been registered. */
  deviceToken: string | null;
  /** Non-null when the last attempt to reach an address failed. */
  problem: string | null;
  connect(address: string): Promise<void>;
  forget(): Promise<void>;
  signOut(): Promise<void>;
  signIn(input: {
    email: string;
    password?: string;
    link?: string;
    challengeToken?: string;
    code?: string;
  }): Promise<SignInResult>;
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
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<InstanceState["status"]>("loading");
  const revision = useRef(0);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  // Keychain mutations are ordered even when a login returns during sign-out.
  const change = useCallback((work: () => Promise<void>) => {
    const task = pending.current.then(work, work);
    pending.current = task.catch(() => {});
    return task;
  }, []);

  const connect = useCallback(async (address: string) => {
    const request = ++revision.current;
    setSession(null);
    setStatus("loading");
    await change(async () => {
      if (request !== revision.current) return;
      const stored = await loadSession(keychain);
      if (request !== revision.current) return;
      const normalized = normalizeAddress(address);
      const matching = stored && "url" in normalized && stored.instanceUrl === normalized.url ? stored : null;
      const device = matching ? await loadDeviceToken(keychain) : null;
      if (request !== revision.current) return;
      if (matching) {
        // Cache/keychain failure may disable offline reads, never force plaintext.
        await privateCaches.activate(privateCacheOwner(matching)).catch(() => {});
      } else {
        await privateCaches.clear();
      }
      if (request !== revision.current) return;
      const cache = matching ? privateCaches.get(privateCacheOwner(matching)) : noCache;
      const result = await discoverWithCache(address, (url) => fetchWithTimeout(url), cache);
      if (request !== revision.current) return;
      if (!result.ok) {
        setProblem(result.message);
        setStatus("needs-instance");
        return;
      }
      await SecureStore.setItemAsync(INSTANCE_KEY, result.instance.url);
      if (stored && !matching) await clearSession(keychain);
      if (request !== revision.current) return;
      setSession(matching);
      setDeviceToken(matching ? device : null);
      setInstance(result.instance);
      setProblem(null);
      setStatus("ready");
    });
  }, [change]);

  const forget = useCallback(async () => {
    ++revision.current;
    const cleanup = privateCaches.clear();
    void cleanup.catch(() => {});
    setInstance(null);
    setSession(null);
    setDeviceToken(null);
    setStatus("needs-instance");
    await change(async () => {
      try {
        await clearSession(keychain);
        await clearDeviceToken(keychain);
        await SecureStore.deleteItemAsync(INSTANCE_KEY);
      } finally { await cleanup; }
    });
  }, [change]);

  const signOut = useCallback(async () => {
    ++revision.current;
    const cleanup = privateCaches.clear();
    void cleanup.catch(() => {});
    setSession(null);
    setDeviceToken(null);
    await change(async () => {
      try {
        await clearSession(keychain);
        await clearDeviceToken(keychain);
      } finally { await cleanup; }
    });
  }, [change]);

  const signIn = useCallback(async (input: {
    email: string;
    password?: string;
    link?: string;
    challengeToken?: string;
    code?: string;
  }): Promise<SignInResult> => {
    if (!instance) return { ok: false, reason: "unreachable", message: "Connect first." };
    const generation = ++revision.current;
    const request = { ...input, instanceUrl: instance.url };
    const result = input.challengeToken && input.code
      ? await completeTwoFactorSignIn(
          { instanceUrl: instance.url, email: input.email, challengeToken: input.challengeToken, code: input.code },
          (url, init) => fetch(url, init),
        )
      : input.link
        ? await redeemSignInLink({ ...request, link: input.link }, (url, init) => fetch(url, init))
        : await requestSignIn(request, (url, init) => fetch(url, init));
    if (result.ok) {
      await change(async () => {
        if (generation !== revision.current) return;
        await saveSession(keychain, result.session);
        if (generation !== revision.current) return;
        await privateCaches.activate(privateCacheOwner(result.session)).catch(() => {});
        if (generation !== revision.current) return;
        await rememberInstance(instance, privateCaches.get(privateCacheOwner(result.session)));
        if (generation !== revision.current) return;
        setSession(result.session);
      });
    }
    if (generation !== revision.current) return { ok: false, reason: "unreachable", message: "The sign-in was cancelled. Try again." };
    return result;
  }, [instance, change]);

  useEffect(() => {
    void (async () => {
      const remembered = await SecureStore.getItemAsync(INSTANCE_KEY);
      if (!remembered) {
        setStatus("needs-instance");
        return;
      }
      await connect(remembered);
    })().catch((error: unknown) => {
      setProblem(error instanceof Error ? error.message : String(error));
      setStatus("needs-instance");
    });
  }, [connect]);

  const value = useMemo<InstanceState>(
    () => ({
      status,
      instance,
      brand: instance ? brandFrom(instance) : null,
      session,
      deviceToken,
      problem,
      connect,
      forget,
      signOut,
      signIn,
    }),
    [status, instance, session, deviceToken, problem, connect, forget, signOut, signIn],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export { saveSession };
