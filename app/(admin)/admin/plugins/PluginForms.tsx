// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  addPluginRegistryAction,
  disablePluginAction,
  enablePluginAction,
  installPluginAction,
  rollbackPluginAction,
  uninstallPluginAction,
  updatePluginAction,
  trustPublisherKeyAction,
  revokePublisherKeyAction,
  setRegistryPublisherKeyAction,
  cachePluginRegistryAction,
  approvePluginPermissionsAction,
  revokePluginPermissionsAction,
  type PluginActionState,
} from "../../plugin-actions";

const empty: PluginActionState = {};

export function PluginPermissionsForm({ name, scopeHash, approved, canReview, labels }: {
  name: string; scopeHash: string; approved: boolean; canReview: boolean;
  labels: { confirmation: string; approve: string; saved: string; revoke: string; revokeConfirmation: string; revoked: string };
}) {
  const [approval, approve, approving] = useActionState(approvePluginPermissionsAction, empty);
  const [revocation, revoke, revoking] = useActionState(revokePluginPermissionsAction, empty);
  return <div className="grid gap-3">
    <form action={approve} data-plugin-consent={name} className="grid gap-2">
      <input type="hidden" name="name" value={name} /><input type="hidden" name="scopeHash" value={scopeHash} />
      {approval.error ? <p role="alert" className="text-sm text-danger">{approval.error}</p> : null}
      {approval.saved ? <p role="status" className="text-sm text-success">{labels.saved}</p> : null}
      <label className="flex items-start gap-2 text-sm"><input name="confirmation" type="checkbox" required disabled={!canReview || approving} className="mt-1 h-4 w-4 accent-accent" /><span>{labels.confirmation}</span></label>
      <div><Button type="submit" disabled={!canReview || approving}>{labels.approve}</Button></div>
    </form>
    {approved ? <form action={revoke} data-plugin-revoke={name} className="grid gap-2">
      <input type="hidden" name="name" value={name} />
      {revocation.error ? <p role="alert" className="text-sm text-danger">{revocation.error}</p> : null}
      {revocation.saved ? <p role="status" className="text-sm text-ink-muted">{labels.revoked}</p> : null}
      <label className="flex items-start gap-2 text-sm"><input name="confirmation" type="checkbox" required disabled={!canReview || revoking} className="mt-1 h-4 w-4 accent-accent" /><span>{labels.revokeConfirmation}</span></label>
      <div><Button type="submit" variant="quiet" disabled={!canReview || revoking}>{labels.revoke}</Button></div>
    </form> : null}
  </div>;
}

export function InstallPluginForm({
  labels,
}: {
  labels: { path: string; submit: string; error: string; signature: string; signatureHint: string };
}) {
  const [state, action] = useActionState(installPluginAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="path" label={labels.path}>
        <Input id="path" name="path" required />
      </Field>
      <Field htmlFor="install-signature" label={labels.signature} hint={labels.signatureHint}>
        <Input id="install-signature" name="signature" dir="ltr" maxLength={256} required aria-describedby="install-signature-hint" />
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function PluginRowActions({
  name,
  status,
  source,
  previousVersion,
  labels,
}: {
  name: string;
  status: string;
  source: string;
  previousVersion: string | null;
  labels: {
    enable: string;
    disable: string;
    uninstall: string;
    keep: string;
    purge: string;
    update: string;
    path: string;
    rollback: string;
    rollbackUnavailable: string;
    error: string;
    signature: string;
  };
}) {
  const [updateState, updateAction] = useActionState(updatePluginAction, empty);
  const [enableState, enableAction] = useActionState(enablePluginAction, empty);
  const [rollbackState, rollbackAction] = useActionState(rollbackPluginAction, empty);
  return (
    <div className="grid gap-3">
      {enableState.error || rollbackState.error ? <p role="alert" className="text-sm font-medium text-danger">{enableState.error || rollbackState.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {status === "enabled" ? (
          <form action={disablePluginAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit">{labels.disable}</Button>
          </form>
        ) : (
          <form action={enableAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit">{labels.enable}</Button>
          </form>
        )}
        <form action={uninstallPluginAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="name" value={name} />
          <Select name="retention" defaultValue="keep" aria-label={labels.keep}>
            <option value="keep">{labels.keep}</option>
            <option value="purge">{labels.purge}</option>
          </Select>
          <Button type="submit">{labels.uninstall}</Button>
        </form>
        {previousVersion ? (
          <form action={rollbackAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit" variant="quiet">
              {labels.rollback}
            </Button>
          </form>
        ) : (
          <p className="self-center text-xs text-ink-muted">{labels.rollbackUnavailable}</p>
        )}
      </div>
      <form action={updateAction} className="flex flex-wrap items-end gap-2">
        {updateState.error ? (
          <p role="alert" className="w-full text-sm font-medium text-danger">
            {updateState.error}
          </p>
        ) : null}
        <Field htmlFor={`update-path-${name}`} label={labels.path}>
          <Input id={`update-path-${name}`} name="path" required defaultValue={source} />
        </Field>
        <Field htmlFor={`update-signature-${name}`} label={labels.signature}>
          <Input id={`update-signature-${name}`} name="signature" dir="ltr" maxLength={256} required />
        </Field>
        <Button type="submit" variant="quiet">
          {labels.update}
        </Button>
      </form>
    </div>
  );
}

export function AddRegistryForm({
  labels,
  publisherKeys,
  canChangeTrust,
}: {
  labels: {
    name: string;
    url: string;
    tier: string;
    submit: string;
    error: string;
    verified: string;
    community: string;
    private: string;
    local: string;
    publisherKey: string;
    chooseKey: string;
  };
  publisherKeys: PublisherKeyChoice[];
  canChangeTrust: boolean;
}) {
  const [state, action] = useActionState(addPluginRegistryAction, empty);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {state.error ? (
        <p role="alert" className="sm:col-span-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="registry-name" label={labels.name}>
        <Input id="registry-name" name="name" required maxLength={80} />
      </Field>
      <Field htmlFor="registry-url" label={labels.url}>
        <Input id="registry-url" name="url" type="url" required />
      </Field>
      <Field htmlFor="registry-tier" label={labels.tier}>
        <Select id="registry-tier" name="tier" defaultValue="community">
          <option value="verified">{labels.verified}</option>
          <option value="community">{labels.community}</option>
          <option value="private">{labels.private}</option>
          <option value="local">{labels.local}</option>
        </Select>
      </Field>
      <Field htmlFor="registry-publisher-key" label={labels.publisherKey}>
        <Select id="registry-publisher-key" name="publisherKeyId" required defaultValue="">
          <option value="">{labels.chooseKey}</option>
          {publisherKeys.map(key => <option key={key.keyId} value={key.keyId}>{key.publisher} · {key.keyId.slice(0, 12)}</option>)}
        </Select>
      </Field>
      <div className="self-end">
        <Button type="submit" disabled={!canChangeTrust}>{labels.submit}</Button>
      </div>
    </form>
  );
}

export interface PublisherKeyChoice { keyId: string; publisher: string }

export function TrustPublisherForm({ labels, canChangeTrust, publisherNames }: {
  labels: { publisher: string; publisherHint: string; publicKey: string; fingerprint: string; fingerprintHint: string; confirmation: string; submit: string; saved: string };
  canChangeTrust: boolean;
  publisherNames: string[];
}) {
  const [state, action] = useActionState(trustPublisherKeyAction, empty);
  return <form action={action} className="grid gap-4">
    {state.error ? <p role="alert" className="text-sm font-medium text-danger">{state.error}</p> : null}
    {state.saved ? <p role="status" className="text-sm text-success">{labels.saved}</p> : null}
    <Field htmlFor="publisher-name" label={labels.publisher} hint={labels.publisherHint}><Input id="publisher-name" name="publisher" required maxLength={120} list="publisher-names" aria-describedby="publisher-name-hint" /><datalist id="publisher-names">{publisherNames.map(name => <option key={name} value={name} />)}</datalist></Field>
    <Field htmlFor="publisher-public-key" label={labels.publicKey}>
      <textarea id="publisher-public-key" name="publicKey" dir="ltr" rows={4} maxLength={2048} required spellCheck={false} autoCapitalize="none"
        className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 font-mono text-base text-ink focus-visible:border-accent" />
    </Field>
    <Field htmlFor="publisher-fingerprint" label={labels.fingerprint} hint={labels.fingerprintHint}>
      <Input id="publisher-fingerprint" name="fingerprint" dir="ltr" required minLength={64} maxLength={64} pattern="[a-f0-9]{64}" autoCapitalize="none" spellCheck={false} aria-describedby="publisher-fingerprint-hint" />
    </Field>
    <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" name="confirmation" value="yes" required className="mt-1 h-4 w-4 accent-accent" />{labels.confirmation}</label>
    <div><Button type="submit" disabled={!canChangeTrust}>{labels.submit}</Button></div>
  </form>;
}

export function RevokePublisherForm({ keyId, revoked, canChangeTrust, labels }: {
  keyId: string; revoked: boolean; canChangeTrust: boolean; labels: { submit: string; saved: string; confirmation: string };
}) {
  const [state, action] = useActionState(revokePublisherKeyAction, empty);
  return <form action={action} className="grid gap-2">
    <input type="hidden" name="keyId" value={keyId} />
    {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
    {state.saved ? <p role="status" className="text-sm text-ink-muted">{labels.saved}</p> : null}
    {!revoked ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" required disabled={!canChangeTrust} className="mt-1" /><span>{labels.confirmation}</span></label> : null}
    <div><Button type="submit" variant="quiet" disabled={revoked || !canChangeTrust}>{labels.submit}</Button></div>
  </form>;
}

export function RegistryPublisherForm({ id, keyId, publisherKeys, canChangeTrust, labels }: {
  id: string; keyId: string | null; publisherKeys: PublisherKeyChoice[]; canChangeTrust: boolean;
  labels: { key: string; choose: string; submit: string; saved: string };
}) {
  const [state, action] = useActionState(setRegistryPublisherKeyAction, empty);
  return <form action={action} className="mt-2 grid gap-2">
    <input type="hidden" name="id" value={id} />
    {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
    {state.saved ? <p role="status" className="text-sm text-ink-muted">{labels.saved}</p> : null}
    <Field htmlFor={`publisher-key-${id}`} label={labels.key}>
      <Select id={`publisher-key-${id}`} name="keyId" required defaultValue={keyId ?? ""}>
        <option value="">{labels.choose}</option>
        {publisherKeys.map(key => <option key={key.keyId} value={key.keyId}>{key.publisher} · {key.keyId.slice(0, 12)}</option>)}
      </Select>
    </Field>
    <div><Button type="submit" variant="quiet" disabled={!canChangeTrust}>{labels.submit}</Button></div>
  </form>;
}

export function CacheRegistryForm({ id, url, trusted, labels }: {
  id: string; url: string; trusted: boolean;
  labels: { index: string; signature: string; submit: string; saved: string };
}) {
  const [state, action] = useActionState(cachePluginRegistryAction, empty);
  return <form action={action} className="mt-3 grid gap-3">
    <input type="hidden" name="url" value={url} />
    {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
    {state.saved ? <p role="status" className="text-sm text-success">{labels.saved}</p> : null}
    <Field htmlFor={`catalog-index-${id}`} label={labels.index}>
      <textarea id={`catalog-index-${id}`} name="index" dir="ltr" rows={4} required spellCheck={false} autoCapitalize="none"
        className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 font-mono text-base text-ink focus-visible:border-accent" />
    </Field>
    <Field htmlFor={`catalog-signature-${id}`} label={labels.signature}>
      <Input id={`catalog-signature-${id}`} name="signature" dir="ltr" required maxLength={256} />
    </Field>
    <div><Button type="submit" variant="quiet" disabled={!trusted}>{labels.submit}</Button></div>
  </form>;
}
