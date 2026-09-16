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
