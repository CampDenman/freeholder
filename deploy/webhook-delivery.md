# Outbound webhook delivery

Freeholder treats every saved webhook URL as an unattended outbound-request
boundary. A URL being owner-supplied does not make its eventual DNS answer
safe.

Immediately before every attempt, the delivery transport:

1. requires HTTPS in production and refuses URL user-info;
2. resolves all DNS answers without allowing the socket layer to resolve again;
3. rejects the entire answer set if any IPv4 or IPv6 address is loopback,
   private, link-local, carrier-grade NAT, multicast, documentation,
   benchmarking, transition or otherwise non-global space;
4. opens a fresh connection directly to the selected checked address while
   retaining the original hostname for TLS certificate validation and `Host`;
5. never follows redirects and bounds both time and retained response bytes.

Local HTTP and loopback delivery are available only outside production so a
developer can use a real receiver. Production has no per-subscription bypass.

DNS failures and prohibited answers are ordinary failed delivery attempts:
they appear in the owner-visible delivery ledger, retry with bounded backoff,
and participate in automatic endpoint pausing. Payloads and signing secrets
must never be copied into process logs while diagnosing transport failures.

## Other externally supplied URLs

The same address-pinned boundary protects remote catalogue indexes, imported
ICS feeds, provider-supplied social media, and contribution hub/status-reply
delivery. Those paths are not webhooks, but the risk is identical: content or
configuration outside the process chooses where the server connects.

Unlike a developer-created webhook receiver, these download paths do not gain
a non-production loopback exception. Media and document responses are capped
while streaming, redirects are refused, and account credentials are never
attached to a provider-supplied media URL.

## Verifying a delivery

Every delivery carries three headers:

| Header | Meaning |
|---|---|
| `freeholder-signature` | `t=<unix seconds>,v1=<hex hmac>` |
| `freeholder-event` | the event name, for routing |
| `freeholder-delivery` | the delivery id; stable across retries of the same delivery, and the right idempotency key |

The body is JSON: `{ id, event, at, schemaVersion, data }`, where `at` is in
seconds so it compares like-for-like with the signature's `t`.

**Sign the timestamp, not just the body.** The HMAC is computed over
`` `${t}.${body}` `` — the raw request body exactly as received, prefixed with
the same `t` that appears in the header, joined by a literal `.`:

```
expected = HMAC_SHA256(your_signing_secret, `${t}.${rawBody}`)   // hex
```

A signature over the body alone would be replayable forever by anyone who ever
saw one request, and you would have no way to tell a retry from an attack. This
is why the timestamp is inside the signed material.

**You choose the tolerance, and you must enforce it.** Freeholder does not
impose a window: reject the request if `|now - t|` exceeds whatever you are
willing to accept. 300 seconds is a reasonable default and is what Freeholder's
own reference verifier uses. Compare in both directions so that clock skew
either way is handled.

**If you skip the timestamp check you have no replay protection at all** — the
signature will keep verifying for as long as the secret lives. That check is
the property this scheme exists to provide.

Verify in constant time (`crypto.timingSafeEqual` or your language's
equivalent), and treat a missing or unparsable header as a failure rather than
a pass.

```js
// Node, as a receiver would write it.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, rawBody, header, toleranceSeconds = 300) {
  const parts = new Map(header.split(",").map(p => {
    const [k, ...rest] = p.trim().split("=");
    return [k, rest.join("=")];
  }));
  const t = Number(parts.get("t"));
  const presented = parts.get("v1");
  if (!Number.isFinite(t) || !presented) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`verifySignature` in `src/core/webhooks/sign.ts` is this same function, exported
and covered by the signer's own tests, so the scheme is held to a verifier that
actually runs rather than to prose.

**The scheme is versioned.** Today only `v1=` is emitted. Match on the version
you understand and ignore unknown ones, so a future algorithm can be introduced
alongside `v1` rather than as a flag day for every receiver at once.

**Replay from the owner's delivery ledger is a new delivery**, signed at the
time it is re-sent, not a byte-for-byte resend of the original request. Its
`freeholder-delivery` id is the one to deduplicate on; a replay carries a new
one, because it is a deliberate new attempt rather than a retry.
