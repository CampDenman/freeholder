// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: bounded compatibility for reading old state and exporting a signed
// migration. No new application messages or ordinary groups use this engine.
import { createGroupInfoWithExternalPubAndRatchetTree, decodeGroupState, decodeMlsMessage, emptyPskIndex, encodeGroupState, joinGroup, processPrivateMessage, processPublicMessage, type ClientState, type Credential, type PrivateKeyPackage } from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { createGroupInfo } from "ts-mls/createCommit.js";
import { encodeGroupInfo } from "ts-mls/groupInfo.js";
import { encode } from "ts-mls/codec/tlsEncoder.js";
import { varLenDataEncoder } from "ts-mls/codec/variableLength.js";
import { b64, parseIdentity, suite, unb64 } from "./wire";

export type LegacyState = ClientState;
type Entry = { userId: string; deviceId: string; signatureKey: string };
export function legacyDevices(state: Pick<LegacyState, "ratchetTree">): Entry[] {
  return state.ratchetTree.flatMap((node) => {
    if (node?.nodeType !== "leaf" || node.leaf.credential.credentialType !== "basic") return [];
    const who = parseIdentity(node.leaf.credential.identity);
    return who ? [{ ...who, signatureKey: b64(node.leaf.signaturePublicKey) }] : [];
  });
}
export function legacyConfig(directory: Entry[], state?: Pick<LegacyState, "ratchetTree">, historicalWelcome = false) {
  // Old bindings are private historical pins. They authorize reading/removal,
  // never an OpenMLS send, which requires the fresh server directory.
  const keys = new Map([...(state ? legacyDevices(state) : []), ...directory].map((d) => [d.deviceId, d]));
  return { ...defaultClientConfig, authService: { async validateCredential(credential: Credential, signaturePublicKey: Uint8Array) {
    const who = credential.credentialType === "basic" ? parseIdentity(credential.identity) : null;
    const known = who ? keys.get(who.deviceId) : undefined;
    if (!who) return false;
    if (known) return known.userId === who.userId && known.signatureKey === b64(signaturePublicKey);
    // A Welcome authenticates its historical tree with the consumed package.
    // Unknown old leaves are local history pins, never current send authority.
    return historicalWelcome && signaturePublicKey.length === 32;
  } } };
}
export function loadLegacy(bytes: Uint8Array, directory: Entry[]): LegacyState {
  const decoded = decodeGroupState(bytes, 0);
  if (!decoded || decoded[1] !== bytes.length) throw new Error("Invalid saved encryption state.");
  return { ...decoded[0], clientConfig: legacyConfig(directory, decoded[0]) };
}
export const saveLegacy = (state: LegacyState) => encodeGroupState(state);
export async function joinLegacy(welcomeBytes: string, publicPackage: string, privatePackage: PrivateKeyPackage, directory: Entry[]): Promise<LegacyState> {
  const message = decodeMlsMessage(unb64(welcomeBytes), 0)?.[0];
  const published = decodeMlsMessage(unb64(publicPackage), 0)?.[0];
  if (message?.wireformat !== "mls_welcome" || published?.wireformat !== "mls_key_package") throw new Error("Invalid historical welcome.");
  return joinGroup(message.welcome, published.keyPackage, privatePackage, emptyPskIndex, await suite(), undefined, undefined, legacyConfig(directory, undefined, true));
}
export async function processLegacy(state: LegacyState, encoded: string, directory: Entry[]) {
  state = { ...state, clientConfig: legacyConfig(directory, state) };
  const message = decodeMlsMessage(unb64(encoded), 0)?.[0];
  const cs = await suite();
  if (message?.wireformat === "mls_private_message") return processPrivateMessage(state, message.privateMessage, emptyPskIndex, cs);
  if (message?.wireformat === "mls_public_message") return processPublicMessage(state, message.publicMessage, emptyPskIndex, cs);
  throw new Error("Invalid historical MLS message.");
}
export async function migrationInfo(state: LegacyState): Promise<string> {
  const cs = await suite();
  const original = await createGroupInfoWithExternalPubAndRatchetTree(state, [], cs);
  const extensions = original.extensions.map((extension) => extension.extensionType === "external_pub" ? { ...extension, extensionData: encode(varLenDataEncoder)(extension.extensionData) } : extension);
  // Correct the legacy helper's missing HPKEPublicKey opaque<V> frame and
  // sign through its own codec with the existing device identity.
  return b64(encodeGroupInfo(await createGroupInfo(state.groupContext, state.confirmationTag, state, extensions, cs)));
}
